import {
  VELAR_ERROR_NORMALIZATION_RUNTIME,
  VELAR_RUNTIME_REGISTRY_KEY,
  VELAR_RUNTIME_SCHEMA_VERSION,
} from "@velarscript/compiler/extension";

export const WEB_DOM_HOST_RUNTIME = String.raw`
const __velarDomNativeObject = globalThis.Object;
const __velarDomNativeArray = globalThis.Array;
const __velarDomNativeSet = globalThis.Set;
const __velarDomNativeNumber = globalThis.Number;
const __velarDomNativeString = globalThis.String;
const __velarDomNativeSymbol = globalThis.Symbol;
const __velarDomReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarDomGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarDomGetOwnPropertyNames = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyNames")?.value;
const __velarDomGetOwnPropertySymbols = Object.getOwnPropertyDescriptor(Object, "getOwnPropertySymbols")?.value;
const __velarDomGetPrototypeOf = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")?.value;
const __velarDomDefineProperty = Object.getOwnPropertyDescriptor(Object, "defineProperty")?.value;
const __velarDomArrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")?.value;
const __velarDomNumberIsFinite = Object.getOwnPropertyDescriptor(Number, "isFinite")?.value;
const __velarDomNumberIsInteger = Object.getOwnPropertyDescriptor(Number, "isInteger")?.value;
const __velarDomSymbolHasInstance = typeof __velarDomNativeSymbol === "function" ? __velarDomNativeSymbol.hasInstance : null;
const __velarDomFunctionHasInstance = __velarDomSymbolHasInstance == null
  ? null
  : Object.getOwnPropertyDescriptor(Function.prototype, __velarDomSymbolHasInstance)?.value;
const __velarDomSetPrototype = typeof __velarDomNativeSet === "function"
  ? Object.getOwnPropertyDescriptor(__velarDomNativeSet, "prototype")?.value
  : null;
const __velarDomSetHas = __velarDomSetPrototype && Object.getOwnPropertyDescriptor(__velarDomSetPrototype, "has")?.value;
const __velarDomSetAdd = __velarDomSetPrototype && Object.getOwnPropertyDescriptor(__velarDomSetPrototype, "add")?.value;
const __velarDomSetDelete = __velarDomSetPrototype && Object.getOwnPropertyDescriptor(__velarDomSetPrototype, "delete")?.value;
const __velarDomDocument = globalThis.document ?? null;
const __velarDomNativeNode = typeof globalThis.Node === "function" ? globalThis.Node : null;
const __velarDomNativeElement = typeof globalThis.Element === "function" ? globalThis.Element : null;
const __velarDomNativeDocument = typeof globalThis.Document === "function" ? globalThis.Document : null;
const __velarDomNativeFragment = typeof globalThis.DocumentFragment === "function" ? globalThis.DocumentFragment : null;
const __velarDomNativeCharacterData = typeof globalThis.CharacterData === "function" ? globalThis.CharacterData : null;
const __velarDomNativeDocumentType = typeof globalThis.DocumentType === "function" ? globalThis.DocumentType : null;
const __velarDomNativeNodeList = typeof globalThis.NodeList === "function" ? globalThis.NodeList : null;
const __velarDomNativeEventTarget = typeof globalThis.EventTarget === "function" ? globalThis.EventTarget : null;
const __velarDomNativeHtmlElement = typeof globalThis.HTMLElement === "function" ? globalThis.HTMLElement : null;
const __velarDomNativeSvgElement = typeof globalThis.SVGElement === "function" ? globalThis.SVGElement : null;
const __velarDomNativeStyleDeclaration = typeof globalThis.CSSStyleDeclaration === "function" ? globalThis.CSSStyleDeclaration : null;
const __velarDomNativeTokenList = typeof globalThis.DOMTokenList === "function" ? globalThis.DOMTokenList : null;
const __velarDomNativeInputElement = typeof globalThis.HTMLInputElement === "function" ? globalThis.HTMLInputElement : null;
const __velarDomNativeTextAreaElement = typeof globalThis.HTMLTextAreaElement === "function" ? globalThis.HTMLTextAreaElement : null;
const __velarDomNativeSelectElement = typeof globalThis.HTMLSelectElement === "function" ? globalThis.HTMLSelectElement : null;
function __velarDomApply(operation, receiver, arguments_, label) {
  if (typeof operation !== "function" || typeof __velarDomReflectApply !== "function") {
    throw new TypeError("The browser " + label + " API is unavailable");
  }
  return __velarDomReflectApply(operation, receiver, arguments_);
}
function __velarDomOwnDescriptor(value, name) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null
    || typeof __velarDomGetOwnPropertyDescriptor !== "function" || typeof __velarDomReflectApply !== "function") return null;
  return __velarDomReflectApply(__velarDomGetOwnPropertyDescriptor, __velarDomNativeObject, [value, name]) ?? null;
}
function __velarDomMember(value, name, kind = "value") {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
  let current = value;
  for (let depth = 0; current && depth < 32; depth += 1) {
    const descriptor = __velarDomOwnDescriptor(current, name);
    if (descriptor) {
      const member = kind === "get" ? descriptor.get : kind === "set" ? descriptor.set : "value" in descriptor ? descriptor.value : null;
      return typeof member === "function" ? member : null;
    }
    if (typeof __velarDomGetPrototypeOf !== "function" || typeof __velarDomReflectApply !== "function") return null;
    current = __velarDomReflectApply(__velarDomGetPrototypeOf, __velarDomNativeObject, [current]);
  }
  return null;
}
function __velarDomPrototype(constructor) {
  return typeof constructor === "function" ? __velarDomOwnDescriptor(constructor, "prototype")?.value ?? null : null;
}
function __velarDomPrototypeMember(constructor, name, kind = "value") {
  return __velarDomMember(__velarDomPrototype(constructor), name, kind);
}
function __velarDomInstance(value, constructor) {
  if (typeof constructor !== "function" || typeof __velarDomFunctionHasInstance !== "function") return false;
  try { return __velarDomApply(__velarDomFunctionHasInstance, constructor, [value], "Node identity"); }
  catch { return false; }
}
const __velarDomDocumentCreateElement = __velarDomMember(__velarDomDocument, "createElement");
const __velarDomDocumentCreateElementNS = __velarDomMember(__velarDomDocument, "createElementNS");
const __velarDomDocumentCreateTextNode = __velarDomMember(__velarDomDocument, "createTextNode");
const __velarDomDocumentCreateComment = __velarDomMember(__velarDomDocument, "createComment");
const __velarDomDocumentCreateFragment = __velarDomMember(__velarDomDocument, "createDocumentFragment");
const __velarDomDocumentQuerySelector = __velarDomMember(__velarDomDocument, "querySelector");
const __velarDomNodeNodeType = __velarDomPrototypeMember(__velarDomNativeNode, "nodeType", "get");
const __velarDomNodeChildNodes = __velarDomPrototypeMember(__velarDomNativeNode, "childNodes", "get");
const __velarDomNodeInsertBefore = __velarDomPrototypeMember(__velarDomNativeNode, "insertBefore");
const __velarDomNodeReplaceChildren = __velarDomPrototypeMember(__velarDomNativeNode, "replaceChildren");
const __velarDomNodeAppend = __velarDomPrototypeMember(__velarDomNativeNode, "append");
const __velarDomNodeTextContentSet = __velarDomPrototypeMember(__velarDomNativeNode, "textContent", "set");
const __velarDomElementAppend = __velarDomPrototypeMember(__velarDomNativeElement, "append");
const __velarDomElementReplaceChildren = __velarDomPrototypeMember(__velarDomNativeElement, "replaceChildren");
const __velarDomDocumentAppend = __velarDomPrototypeMember(__velarDomNativeDocument, "append");
const __velarDomDocumentReplaceChildren = __velarDomPrototypeMember(__velarDomNativeDocument, "replaceChildren");
const __velarDomFragmentAppend = __velarDomPrototypeMember(__velarDomNativeFragment, "append");
const __velarDomFragmentReplaceChildren = __velarDomPrototypeMember(__velarDomNativeFragment, "replaceChildren");
const __velarDomNodeRemove = __velarDomPrototypeMember(__velarDomNativeNode, "remove");
const __velarDomElementRemove = __velarDomPrototypeMember(__velarDomNativeElement, "remove");
const __velarDomCharacterDataRemove = __velarDomPrototypeMember(__velarDomNativeCharacterData, "remove");
const __velarDomDocumentTypeRemove = __velarDomPrototypeMember(__velarDomNativeDocumentType, "remove");
const __velarDomNodeBefore = __velarDomPrototypeMember(__velarDomNativeNode, "before");
const __velarDomElementBefore = __velarDomPrototypeMember(__velarDomNativeElement, "before");
const __velarDomCharacterDataBefore = __velarDomPrototypeMember(__velarDomNativeCharacterData, "before");
const __velarDomDocumentTypeBefore = __velarDomPrototypeMember(__velarDomNativeDocumentType, "before");
const __velarDomNodeSetAttribute = __velarDomPrototypeMember(__velarDomNativeNode, "setAttribute");
const __velarDomElementSetAttribute = __velarDomPrototypeMember(__velarDomNativeElement, "setAttribute");
const __velarDomElementSetAttributeNS = __velarDomPrototypeMember(__velarDomNativeElement, "setAttributeNS");
const __velarDomNodeRemoveAttribute = __velarDomPrototypeMember(__velarDomNativeNode, "removeAttribute");
const __velarDomElementRemoveAttribute = __velarDomPrototypeMember(__velarDomNativeElement, "removeAttribute");
const __velarDomElementRemoveAttributeNS = __velarDomPrototypeMember(__velarDomNativeElement, "removeAttributeNS");
const __velarDomNodeListLength = __velarDomPrototypeMember(__velarDomNativeNodeList, "length", "get");
const __velarDomNodeListItem = __velarDomPrototypeMember(__velarDomNativeNodeList, "item");
const __velarDomNodeNextSibling = __velarDomPrototypeMember(__velarDomNativeNode, "nextSibling", "get");
const __velarDomNodeAddListener = __velarDomPrototypeMember(__velarDomNativeNode, "addEventListener");
const __velarDomNodeRemoveListener = __velarDomPrototypeMember(__velarDomNativeNode, "removeEventListener");
const __velarDomNodeInnerHtml = __velarDomPrototypeMember(__velarDomNativeNode, "innerHTML", "set");
const __velarDomNodeQuerySelectorAll = __velarDomPrototypeMember(__velarDomNativeNode, "querySelectorAll");
const __velarDomNodeClassList = __velarDomPrototypeMember(__velarDomNativeNode, "classList", "get");
const __velarDomNodeStyle = __velarDomPrototypeMember(__velarDomNativeNode, "style", "get");
const __velarDomNodeFieldValue = __velarDomPrototypeMember(__velarDomNativeNode, "value", "get");
const __velarDomNodeSetFieldValue = __velarDomPrototypeMember(__velarDomNativeNode, "value", "set");
const __velarDomNodeFieldNumber = __velarDomPrototypeMember(__velarDomNativeNode, "valueAsNumber", "get");
const __velarDomNodeFieldChecked = __velarDomPrototypeMember(__velarDomNativeNode, "checked", "get");
const __velarDomNodeSetFieldChecked = __velarDomPrototypeMember(__velarDomNativeNode, "checked", "set");
const __velarDomEventTargetAdd = __velarDomPrototypeMember(__velarDomNativeEventTarget, "addEventListener");
const __velarDomEventTargetRemove = __velarDomPrototypeMember(__velarDomNativeEventTarget, "removeEventListener");
const __velarDomElementInnerHtml = __velarDomPrototypeMember(__velarDomNativeElement, "innerHTML", "set");
const __velarDomElementQuerySelectorAll = __velarDomPrototypeMember(__velarDomNativeElement, "querySelectorAll");
const __velarDomElementClassList = __velarDomPrototypeMember(__velarDomNativeElement, "classList", "get");
const __velarDomHtmlElementStyle = __velarDomPrototypeMember(__velarDomNativeHtmlElement, "style", "get");
const __velarDomSvgElementStyle = __velarDomPrototypeMember(__velarDomNativeSvgElement, "style", "get");
const __velarDomStyleSetProperty = __velarDomPrototypeMember(__velarDomNativeStyleDeclaration, "setProperty");
const __velarDomStyleRemoveProperty = __velarDomPrototypeMember(__velarDomNativeStyleDeclaration, "removeProperty");
const __velarDomStylePropertyValue = __velarDomPrototypeMember(__velarDomNativeStyleDeclaration, "getPropertyValue");
const __velarDomStylePropertyPriority = __velarDomPrototypeMember(__velarDomNativeStyleDeclaration, "getPropertyPriority");
const __velarDomTokenListAdd = __velarDomPrototypeMember(__velarDomNativeTokenList, "add");
const __velarDomTokenListRemove = __velarDomPrototypeMember(__velarDomNativeTokenList, "remove");
const __velarDomTokenListLength = __velarDomPrototypeMember(__velarDomNativeTokenList, "length", "get");
const __velarDomTokenListItem = __velarDomPrototypeMember(__velarDomNativeTokenList, "item");
const __velarDomInputValueGet = __velarDomPrototypeMember(__velarDomNativeInputElement, "value", "get");
const __velarDomInputValueSet = __velarDomPrototypeMember(__velarDomNativeInputElement, "value", "set");
const __velarDomInputNumberGet = __velarDomPrototypeMember(__velarDomNativeInputElement, "valueAsNumber", "get");
const __velarDomInputCheckedGet = __velarDomPrototypeMember(__velarDomNativeInputElement, "checked", "get");
const __velarDomInputCheckedSet = __velarDomPrototypeMember(__velarDomNativeInputElement, "checked", "set");
const __velarDomTextAreaValueGet = __velarDomPrototypeMember(__velarDomNativeTextAreaElement, "value", "get");
const __velarDomTextAreaValueSet = __velarDomPrototypeMember(__velarDomNativeTextAreaElement, "value", "set");
const __velarDomSelectValueGet = __velarDomPrototypeMember(__velarDomNativeSelectElement, "value", "get");
const __velarDomSelectValueSet = __velarDomPrototypeMember(__velarDomNativeSelectElement, "value", "set");
function __velarDomOwnData(value, name) {
  const descriptor = __velarDomOwnDescriptor(value, name);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
}
function __velarDomOwnMethod(value, name) {
  const method = __velarDomOwnData(value, name);
  return typeof method === "function" ? method : null;
}
function __velarDomNodeOperation(value, name, candidates, arguments_) {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (__velarDomInstance(value, candidate[0]) && typeof candidate[1] === "function") {
      return __velarDomApply(candidate[1], value, arguments_, "DOM " + name);
    }
  }
  const own = __velarDomOwnMethod(value, name);
  if (own) return __velarDomApply(own, value, arguments_, "DOM " + name);
  throw new TypeError("The value does not expose native DOM " + name);
}
function __velarDomCreateElement(tag) { return __velarDomApply(__velarDomDocumentCreateElement, __velarDomDocument, [tag], "document.createElement"); }
function __velarDomCreateElementNS(namespace, tag) { return __velarDomApply(__velarDomDocumentCreateElementNS, __velarDomDocument, [namespace, tag], "document.createElementNS"); }
function __velarDomCreateTextNode(value) { return __velarDomApply(__velarDomDocumentCreateTextNode, __velarDomDocument, [value], "document.createTextNode"); }
function __velarDomCreateComment(value) { return __velarDomApply(__velarDomDocumentCreateComment, __velarDomDocument, [value], "document.createComment"); }
function __velarDomCreateFragment() { return __velarDomApply(__velarDomDocumentCreateFragment, __velarDomDocument, [], "document.createDocumentFragment"); }
function __velarDomQuerySelector(value) { return __velarDomApply(__velarDomDocumentQuerySelector, __velarDomDocument, [value], "document.querySelector"); }
function __velarDomAppend(value, ...children) {
  return __velarDomNodeOperation(value, "append", [
    [__velarDomNativeNode, __velarDomNodeAppend], [__velarDomNativeElement, __velarDomElementAppend],
    [__velarDomNativeDocument, __velarDomDocumentAppend], [__velarDomNativeFragment, __velarDomFragmentAppend],
  ], children);
}
function __velarDomInsertBefore(value, child, before = null) {
  return __velarDomNodeOperation(value, "insertBefore", [[__velarDomNativeNode, __velarDomNodeInsertBefore]], [child, before]);
}
function __velarDomReplaceChildren(value, ...children) {
  return __velarDomNodeOperation(value, "replaceChildren", [
    [__velarDomNativeNode, __velarDomNodeReplaceChildren], [__velarDomNativeElement, __velarDomElementReplaceChildren],
    [__velarDomNativeDocument, __velarDomDocumentReplaceChildren], [__velarDomNativeFragment, __velarDomFragmentReplaceChildren],
  ], children);
}
function __velarDomRemove(value) {
  return __velarDomNodeOperation(value, "remove", [
    [__velarDomNativeNode, __velarDomNodeRemove], [__velarDomNativeElement, __velarDomElementRemove],
    [__velarDomNativeCharacterData, __velarDomCharacterDataRemove], [__velarDomNativeDocumentType, __velarDomDocumentTypeRemove],
  ], []);
}
function __velarDomBefore(value, child) {
  return __velarDomNodeOperation(value, "before", [
    [__velarDomNativeNode, __velarDomNodeBefore], [__velarDomNativeElement, __velarDomElementBefore],
    [__velarDomNativeCharacterData, __velarDomCharacterDataBefore], [__velarDomNativeDocumentType, __velarDomDocumentTypeBefore],
  ], [child]);
}
function __velarDomSetAttribute(value, name, next) {
  return __velarDomNodeOperation(value, "setAttribute", [
    [__velarDomNativeNode, __velarDomNodeSetAttribute], [__velarDomNativeElement, __velarDomElementSetAttribute],
  ], [name, next]);
}
function __velarDomSetAttributeNS(value, namespace, name, next) {
  return __velarDomNodeOperation(value, "setAttributeNS", [[__velarDomNativeElement, __velarDomElementSetAttributeNS]], [namespace, name, next]);
}
function __velarDomRemoveAttribute(value, name) {
  return __velarDomNodeOperation(value, "removeAttribute", [
    [__velarDomNativeNode, __velarDomNodeRemoveAttribute], [__velarDomNativeElement, __velarDomElementRemoveAttribute],
  ], [name]);
}
function __velarDomRemoveAttributeNS(value, namespace, name) {
  return __velarDomNodeOperation(value, "removeAttributeNS", [[__velarDomNativeElement, __velarDomElementRemoveAttributeNS]], [namespace, name]);
}
// Accessor twin of __velarDomNodeOperation: the framework reads and writes a
// handful of host properties (style, classList, innerHTML, field value) whose
// prototypes are as replaceable as the methods above, so they go through the
// same captured-then-own-data-descriptor path instead of ambient '.' access.
function __velarDomNodeAccessor(value, name, candidates, arguments_, write) {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (__velarDomInstance(value, candidate[0]) && typeof candidate[1] === "function") {
      return __velarDomApply(candidate[1], value, arguments_, "DOM " + name);
    }
  }
  const descriptor = __velarDomOwnDescriptor(value, name);
  if (!write) {
    if (descriptor && "value" in descriptor) return descriptor.value;
    throw new TypeError("The value does not expose native DOM " + name);
  }
  if (typeof __velarDomDefineProperty !== "function" || typeof __velarDomReflectApply !== "function"
    || (descriptor && (!("value" in descriptor) || descriptor.writable !== true))) {
    throw new TypeError("The value does not expose native DOM " + name);
  }
  return __velarDomReflectApply(__velarDomDefineProperty, __velarDomNativeObject, [value, name, descriptor
    ? { ...descriptor, value: arguments_[0] }
    : { value: arguments_[0], writable: true, enumerable: true, configurable: true }]);
}
function __velarDomNextSibling(value) {
  if (__velarDomInstance(value, __velarDomNativeNode) && typeof __velarDomNodeNextSibling === "function") {
    return __velarDomApply(__velarDomNodeNextSibling, value, [], "Node.nextSibling");
  }
  return null;
}
function __velarDomAddListener(value, name, listener, options) {
  return __velarDomNodeOperation(value, "addEventListener", [
    [__velarDomNativeNode, __velarDomNodeAddListener], [__velarDomNativeEventTarget, __velarDomEventTargetAdd],
  ], [name, listener, options]);
}
function __velarDomRemoveListener(value, name, listener, options) {
  return __velarDomNodeOperation(value, "removeEventListener", [
    [__velarDomNativeNode, __velarDomNodeRemoveListener], [__velarDomNativeEventTarget, __velarDomEventTargetRemove],
  ], [name, listener, options]);
}
function __velarDomSetHtml(value, next) {
  return __velarDomNodeAccessor(value, "innerHTML", [
    [__velarDomNativeNode, __velarDomNodeInnerHtml], [__velarDomNativeElement, __velarDomElementInnerHtml],
  ], [next], true);
}
function __velarDomQuerySelectorAll(value, selector) {
  return __velarDomNodeOperation(value, "querySelectorAll", [
    [__velarDomNativeNode, __velarDomNodeQuerySelectorAll], [__velarDomNativeElement, __velarDomElementQuerySelectorAll],
  ], [selector]);
}
function __velarDomStyle(value) {
  return __velarDomNodeAccessor(value, "style", [
    [__velarDomNativeNode, __velarDomNodeStyle], [__velarDomNativeHtmlElement, __velarDomHtmlElementStyle],
    [__velarDomNativeSvgElement, __velarDomSvgElementStyle],
  ], [], false);
}
function __velarDomStyleValue(value, property) {
  return __velarDomNodeOperation(__velarDomStyle(value), "getPropertyValue", [[__velarDomNativeStyleDeclaration, __velarDomStylePropertyValue]], [property]);
}
function __velarDomStylePriority(value, property) {
  return __velarDomNodeOperation(__velarDomStyle(value), "getPropertyPriority", [[__velarDomNativeStyleDeclaration, __velarDomStylePropertyPriority]], [property]);
}
function __velarDomStyleWrite(value, property, next, priority = "") {
  return __velarDomNodeOperation(__velarDomStyle(value), "setProperty", [[__velarDomNativeStyleDeclaration, __velarDomStyleSetProperty]], [property, next, priority]);
}
function __velarDomStyleClear(value, property) {
  return __velarDomNodeOperation(__velarDomStyle(value), "removeProperty", [[__velarDomNativeStyleDeclaration, __velarDomStyleRemoveProperty]], [property]);
}
function __velarDomClassList(value) {
  return __velarDomNodeAccessor(value, "classList", [
    [__velarDomNativeNode, __velarDomNodeClassList], [__velarDomNativeElement, __velarDomElementClassList],
  ], [], false);
}
function __velarDomClassInsert(value, name) {
  return __velarDomNodeOperation(__velarDomClassList(value), "add", [[__velarDomNativeTokenList, __velarDomTokenListAdd]], [name]);
}
function __velarDomClassRemove(value, name) {
  return __velarDomNodeOperation(__velarDomClassList(value), "remove", [[__velarDomNativeTokenList, __velarDomTokenListRemove]], [name]);
}
function __velarDomClassNames(value) {
  const list = __velarDomClassList(value);
  const length = __velarDomInstance(list, __velarDomNativeTokenList) && typeof __velarDomTokenListLength === "function"
    ? __velarDomApply(__velarDomTokenListLength, list, [], "DOMTokenList.length")
    : __velarDomOwnData(list, "length");
  // A data-only seam that exposes no bounded token list simply owns no base
  // classes; only a real token list can contribute names the framework must
  // preserve while it manages the rest.
  if (!__velarDomIsInteger(length) || length < 0 || length > 1000000) return new __velarDomNativeArray(0);
  const output = new __velarDomNativeArray(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = __velarDomNodeOperation(list, "item", [[__velarDomNativeTokenList, __velarDomTokenListItem]], [index]);
  }
  return output;
}
function __velarDomFieldValue(value) {
  return __velarDomNodeAccessor(value, "value", [
    [__velarDomNativeNode, __velarDomNodeFieldValue], [__velarDomNativeInputElement, __velarDomInputValueGet],
    [__velarDomNativeTextAreaElement, __velarDomTextAreaValueGet], [__velarDomNativeSelectElement, __velarDomSelectValueGet],
  ], [], false);
}
function __velarDomSetFieldValue(value, next) {
  return __velarDomNodeAccessor(value, "value", [
    [__velarDomNativeNode, __velarDomNodeSetFieldValue], [__velarDomNativeInputElement, __velarDomInputValueSet],
    [__velarDomNativeTextAreaElement, __velarDomTextAreaValueSet], [__velarDomNativeSelectElement, __velarDomSelectValueSet],
  ], [next], true);
}
function __velarDomFieldNumber(value) {
  return __velarDomNodeAccessor(value, "valueAsNumber", [
    [__velarDomNativeNode, __velarDomNodeFieldNumber], [__velarDomNativeInputElement, __velarDomInputNumberGet],
  ], [], false);
}
function __velarDomFieldChecked(value) {
  return __velarDomNodeAccessor(value, "checked", [
    [__velarDomNativeNode, __velarDomNodeFieldChecked], [__velarDomNativeInputElement, __velarDomInputCheckedGet],
  ], [], false);
}
function __velarDomSetFieldChecked(value, next) {
  return __velarDomNodeAccessor(value, "checked", [
    [__velarDomNativeNode, __velarDomNodeSetFieldChecked], [__velarDomNativeInputElement, __velarDomInputCheckedSet],
  ], [next], true);
}
function __velarDomNodeType(value) {
  if (__velarDomInstance(value, __velarDomNativeNode) && typeof __velarDomNodeNodeType === "function") {
    return __velarDomApply(__velarDomNodeNodeType, value, [], "Node.nodeType");
  }
  const nodeType = __velarDomOwnData(value, "nodeType");
  return typeof nodeType === "number" ? nodeType : null;
}
function __velarDomSetText(value, next) {
  if (__velarDomInstance(value, __velarDomNativeNode) && typeof __velarDomNodeTextContentSet === "function") {
    return __velarDomApply(__velarDomNodeTextContentSet, value, [next], "Node.textContent");
  }
  const descriptor = __velarDomOwnDescriptor(value, "textContent");
  if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.writable !== true
    || typeof __velarDomDefineProperty !== "function" || typeof __velarDomReflectApply !== "function") {
    throw new TypeError("The value does not expose native DOM textContent");
  }
  return __velarDomReflectApply(__velarDomDefineProperty, __velarDomNativeObject, [value, "textContent", { ...descriptor, value: next }]);
}
function __velarDomIsNode(value) {
  return __velarDomInstance(value, __velarDomNativeNode) || __velarDomNodeType(value) !== null;
}
function __velarDomCollectionSnapshot(value, name) {
  let length = null;
  let read = null;
  if (__velarDomInstance(value, __velarDomNativeNodeList) && typeof __velarDomNodeListLength === "function" && typeof __velarDomNodeListItem === "function") {
    length = __velarDomApply(__velarDomNodeListLength, value, [], name + ".length");
    read = (index) => __velarDomApply(__velarDomNodeListItem, value, [index], name + ".item");
  } else if (__velarDomIsArray(value)) {
    length = __velarDomOwnDescriptor(value, "length")?.value;
    read = (index) => __velarDomOwnDescriptor(value, index)?.value;
  }
  if (!__velarDomIsInteger(length) || length < 0 || length > 1000000 || read === null) throw new TypeError(name + " is not a bounded native collection");
  const output = new __velarDomNativeArray(length);
  for (let index = 0; index < length; index += 1) output[index] = read(index);
  return output;
}
function __velarDomChildNodes(value) {
  let children;
  if (__velarDomInstance(value, __velarDomNativeNode) && typeof __velarDomNodeChildNodes === "function") {
    children = __velarDomApply(__velarDomNodeChildNodes, value, [], "Node.childNodes");
  } else children = __velarDomOwnData(value, "childNodes");
  return __velarDomCollectionSnapshot(children, "Node.childNodes");
}
function __velarDomIsArray(value) {
  return typeof __velarDomArrayIsArray === "function" && typeof __velarDomReflectApply === "function"
    && __velarDomReflectApply(__velarDomArrayIsArray, __velarDomNativeArray, [value]);
}
function __velarDomIsFinite(value) {
  return typeof __velarDomNumberIsFinite === "function" && typeof __velarDomReflectApply === "function"
    && __velarDomReflectApply(__velarDomNumberIsFinite, __velarDomNativeNumber, [value]);
}
function __velarDomIsInteger(value) {
  return typeof __velarDomNumberIsInteger === "function" && typeof __velarDomReflectApply === "function"
    && __velarDomReflectApply(__velarDomNumberIsInteger, __velarDomNativeNumber, [value]);
}
function __velarDomString(value) { return __velarDomApply(__velarDomNativeString, undefined, [value], "String"); }
function __velarDomListSnapshot(value, name) {
  if (!__velarDomIsArray(value)) throw new TypeError(name + " requires a List");
  const lengthDescriptor = __velarDomOwnDescriptor(value, "length");
  if (!lengthDescriptor || lengthDescriptor.writable !== true || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) {
    throw new TypeError(name + " requires an ordinary mutable List length");
  }
  const length = lengthDescriptor.value;
  if (!__velarDomIsInteger(length) || length < 0 || length > 1000000) throw new RangeError(name + " cannot exceed 1000000 items");
  const names = __velarDomApply(__velarDomGetOwnPropertyNames, __velarDomNativeObject, [value]);
  const symbols = __velarDomApply(__velarDomGetOwnPropertySymbols, __velarDomNativeObject, [value]);
  if (symbols.length > 0 || names.length !== length + 1) throw new TypeError(name + " requires a dense List without extra fields");
  const output = new __velarDomNativeArray(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = __velarDomOwnDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) {
      throw new TypeError(name + " requires ordinary mutable List elements");
    }
    output[index] = descriptor.value;
  }
  return output;
}
function __velarDomCreateSet() {
  if (typeof __velarDomNativeSet !== "function") throw new TypeError("The browser Set API is unavailable");
  return new __velarDomNativeSet();
}
function __velarDomSetContains(value, item) { return __velarDomApply(__velarDomSetHas, value, [item], "Set.has"); }
function __velarDomSetInsert(value, item) { return __velarDomApply(__velarDomSetAdd, value, [item], "Set.add"); }
function __velarDomSetRemove(value, item) { return __velarDomApply(__velarDomSetDelete, value, [item], "Set.delete"); }
`.trimStart();

export const WEB_REACTIVITY_HOST_RUNTIME = String.raw`
const __velarGraphNativeObject = globalThis.Object;
const __velarGraphNativeArray = globalThis.Array;
const __velarGraphNativeSet = globalThis.Set;
const __velarGraphNativeMap = globalThis.Map;
const __velarGraphNativeWeakSet = globalThis.WeakSet;
const __velarGraphNativeWeakMap = globalThis.WeakMap;
const __velarGraphNativeProxy = globalThis.Proxy;
const __velarGraphReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarGraphArrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")?.value;
const __velarGraphObjectIs = Object.getOwnPropertyDescriptor(Object, "is")?.value;
const __velarGraphObjectFreeze = Object.getOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarGraphObjectDefineProperty = Object.getOwnPropertyDescriptor(Object, "defineProperty")?.value;
const __velarGraphObjectIsExtensible = Object.getOwnPropertyDescriptor(Object, "isExtensible")?.value;
const __velarGraphObjectGetPrototypeOf = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")?.value;
const __velarGraphObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarGraphObjectGetOwnPropertyNames = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyNames")?.value;
const __velarGraphObjectCreate = Object.getOwnPropertyDescriptor(Object, "create")?.value;
const __velarGraphSetPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeSet, "prototype")?.value;
const __velarGraphSetHas = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "has")?.value;
const __velarGraphSetAdd = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "add")?.value;
const __velarGraphSetDelete = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "delete")?.value;
const __velarGraphSetClear = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "clear")?.value;
const __velarGraphSetValues = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "values")?.value;
const __velarGraphSetSize = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "size")?.get;
const __velarGraphMapPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeMap, "prototype")?.value;
const __velarGraphMapHas = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "has")?.value;
const __velarGraphMapGet = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "get")?.value;
const __velarGraphMapSet = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "set")?.value;
const __velarGraphMapDelete = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "delete")?.value;
const __velarGraphMapClear = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "clear")?.value;
const __velarGraphMapValues = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "values")?.value;
const __velarGraphMapKeys = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "keys")?.value;
const __velarGraphMapSize = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "size")?.get;
const __velarGraphWeakSetPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeWeakSet, "prototype")?.value;
const __velarGraphWeakSetHas = __velarGraphWeakSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakSetPrototype, "has")?.value;
const __velarGraphWeakSetAdd = __velarGraphWeakSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakSetPrototype, "add")?.value;
const __velarGraphWeakSetDelete = __velarGraphWeakSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakSetPrototype, "delete")?.value;
const __velarGraphWeakMapPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeWeakMap, "prototype")?.value;
const __velarGraphWeakMapHas = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "has")?.value;
const __velarGraphWeakMapGet = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "get")?.value;
const __velarGraphWeakMapSet = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "set")?.value;
const __velarGraphWeakMapDelete = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "delete")?.value;
const __velarGraphReflectGet = Object.getOwnPropertyDescriptor(Reflect, "get")?.value;
const __velarGraphReflectSet = Object.getOwnPropertyDescriptor(Reflect, "set")?.value;
const __velarGraphReflectHas = Object.getOwnPropertyDescriptor(Reflect, "has")?.value;
const __velarGraphReflectDeleteProperty = Object.getOwnPropertyDescriptor(Reflect, "deleteProperty")?.value;
function __velarGraphApply(operation, receiver, arguments_, label) {
  if (typeof operation !== "function" || typeof __velarGraphReflectApply !== "function") {
    throw new TypeError("The JavaScript " + label + " API is unavailable");
  }
  return __velarGraphReflectApply(operation, receiver, arguments_);
}
function __velarGraphCreateSet(values) {
  const output = new __velarGraphNativeSet();
  if (values !== undefined) for (const value of values) __velarGraphSetInsert(output, value);
  return output;
}
function __velarGraphCreateMap(values) {
  const output = new __velarGraphNativeMap();
  if (values !== undefined) for (const entry of values) __velarGraphMapWrite(output, entry[0], entry[1]);
  return output;
}
function __velarGraphCreateWeakSet() { return new __velarGraphNativeWeakSet(); }
function __velarGraphCreateWeakMap() { return new __velarGraphNativeWeakMap(); }
function __velarGraphSetContains(value, item) { return __velarGraphApply(__velarGraphSetHas, value, [item], "Set.has"); }
function __velarGraphSetInsert(value, item) { return __velarGraphApply(__velarGraphSetAdd, value, [item], "Set.add"); }
function __velarGraphSetRemove(value, item) { return __velarGraphApply(__velarGraphSetDelete, value, [item], "Set.delete"); }
function __velarGraphSetEmpty(value) { return __velarGraphApply(__velarGraphSetClear, value, [], "Set.clear"); }
function __velarGraphSetItems(value) { return __velarGraphApply(__velarGraphSetValues, value, [], "Set.values"); }
function __velarGraphSetCount(value) { return __velarGraphApply(__velarGraphSetSize, value, [], "Set.size"); }
function __velarGraphMapContains(value, key) { return __velarGraphApply(__velarGraphMapHas, value, [key], "Map.has"); }
function __velarGraphMapRead(value, key) { return __velarGraphApply(__velarGraphMapGet, value, [key], "Map.get"); }
function __velarGraphMapWrite(value, key, item) { return __velarGraphApply(__velarGraphMapSet, value, [key, item], "Map.set"); }
function __velarGraphMapRemove(value, key) { return __velarGraphApply(__velarGraphMapDelete, value, [key], "Map.delete"); }
function __velarGraphMapItems(value) { return __velarGraphApply(__velarGraphMapValues, value, [], "Map.values"); }
function __velarGraphMapEmpty(value) { return __velarGraphApply(__velarGraphMapClear, value, [], "Map.clear"); }
function __velarGraphMapKeyItems(value) { return __velarGraphApply(__velarGraphMapKeys, value, [], "Map.keys"); }
function __velarGraphMapCount(value) { return __velarGraphApply(__velarGraphMapSize, value, [], "Map.size"); }
function __velarGraphWeakSetContains(value, item) { return __velarGraphApply(__velarGraphWeakSetHas, value, [item], "WeakSet.has"); }
function __velarGraphWeakSetInsert(value, item) { return __velarGraphApply(__velarGraphWeakSetAdd, value, [item], "WeakSet.add"); }
function __velarGraphWeakSetRemove(value, item) { return __velarGraphApply(__velarGraphWeakSetDelete, value, [item], "WeakSet.delete"); }
function __velarGraphWeakMapContains(value, key) { return __velarGraphApply(__velarGraphWeakMapHas, value, [key], "WeakMap.has"); }
function __velarGraphWeakMapRead(value, key) { return __velarGraphApply(__velarGraphWeakMapGet, value, [key], "WeakMap.get"); }
function __velarGraphWeakMapWrite(value, key, item) { return __velarGraphApply(__velarGraphWeakMapSet, value, [key, item], "WeakMap.set"); }
function __velarGraphWeakMapRemove(value, key) { return __velarGraphApply(__velarGraphWeakMapDelete, value, [key], "WeakMap.delete"); }
function __velarGraphIsList(value) { return __velarGraphApply(__velarGraphArrayIsArray, __velarGraphNativeArray, [value], "Array.isArray"); }
function __velarGraphSame(left, right) { return __velarGraphApply(__velarGraphObjectIs, __velarGraphNativeObject, [left, right], "Object.is"); }
function __velarGraphFreeze(value) { return __velarGraphApply(__velarGraphObjectFreeze, __velarGraphNativeObject, [value], "Object.freeze"); }
function __velarGraphDefine(value, key, descriptor) { return __velarGraphApply(__velarGraphObjectDefineProperty, __velarGraphNativeObject, [value, key, descriptor], "Object.defineProperty"); }
function __velarGraphIsExtensible(value) { return __velarGraphApply(__velarGraphObjectIsExtensible, __velarGraphNativeObject, [value], "Object.isExtensible"); }
function __velarGraphPrototype(value) { return __velarGraphApply(__velarGraphObjectGetPrototypeOf, __velarGraphNativeObject, [value], "Object.getPrototypeOf"); }
function __velarGraphOwnDescriptor(value, key) { return __velarGraphApply(__velarGraphObjectGetOwnPropertyDescriptor, __velarGraphNativeObject, [value, key], "Object.getOwnPropertyDescriptor"); }
function __velarGraphOwnNames(value) { return __velarGraphApply(__velarGraphObjectGetOwnPropertyNames, __velarGraphNativeObject, [value], "Object.getOwnPropertyNames"); }
function __velarGraphCreateRecord() { return __velarGraphApply(__velarGraphObjectCreate, __velarGraphNativeObject, [null], "Object.create"); }
function __velarGraphGet(value, key, receiver) { return __velarGraphApply(__velarGraphReflectGet, null, [value, key, receiver], "Reflect.get"); }
function __velarGraphSet(value, key, item, receiver) { return __velarGraphApply(__velarGraphReflectSet, null, [value, key, item, receiver], "Reflect.set"); }
function __velarGraphHas(value, key) { return __velarGraphApply(__velarGraphReflectHas, null, [value, key], "Reflect.has"); }
function __velarGraphDelete(value, key) { return __velarGraphApply(__velarGraphReflectDeleteProperty, null, [value, key], "Reflect.deleteProperty"); }
`.trimStart();

export const WEB_ERROR_HOST_RUNTIME_BODY = String.raw`
const __velarWebErrorNativeObject = globalThis.Object;
const __velarWebErrorNativeNumber = globalThis.Number;
const __velarWebErrorNativePromise = globalThis.Promise;
const __velarWebErrorOwnSymbolsOperation = Object.getOwnPropertyDescriptor(Object, "getOwnPropertySymbols")?.value;
const __velarWebErrorFreezeOperation = Object.getOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarWebErrorFiniteOperation = Object.getOwnPropertyDescriptor(Number, "isFinite")?.value;
const __velarWebErrorPromisePrototype = Object.getOwnPropertyDescriptor(__velarWebErrorNativePromise, "prototype")?.value;
const __velarWebErrorThenOperation = __velarWebErrorPromisePrototype
  ? Object.getOwnPropertyDescriptor(__velarWebErrorPromisePrototype, "then")?.value
  : null;
function __velarWebErrorOwnSymbols(value) {
  return __velarErrorApply(__velarWebErrorOwnSymbolsOperation, __velarWebErrorNativeObject, [value], "Object.getOwnPropertySymbols");
}
function __velarWebErrorFreeze(value) {
  return __velarErrorApply(__velarWebErrorFreezeOperation, __velarWebErrorNativeObject, [value], "Object.freeze");
}
function __velarWebErrorFinite(value) {
  return __velarErrorApply(__velarWebErrorFiniteOperation, __velarWebErrorNativeNumber, [value], "Number.isFinite");
}
function __velarObservePromise(value, onRejected) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
  try { return __velarErrorApply(__velarWebErrorThenOperation, value, [undefined, onRejected], "Promise.then"); }
  catch { return null; }
}
`.trimStart();

export const WEB_ERROR_HOST_RUNTIME = `${VELAR_ERROR_NORMALIZATION_RUNTIME}\n${WEB_ERROR_HOST_RUNTIME_BODY}`;

function webRuntimeFoundation(errorHostRuntime: string): string {
  return String.raw`
${WEB_REACTIVITY_HOST_RUNTIME}
${WEB_DOM_HOST_RUNTIME}
${errorHostRuntime}
const __velarRuntimeKey = Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)});
const __velarFoundationReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarFoundationQueueMicrotask = globalThis.queueMicrotask;
const __velarFoundationDate = globalThis.Date;
const __velarFoundationDateNow = typeof __velarFoundationDate === "function"
  ? Object.getOwnPropertyDescriptor(__velarFoundationDate, "now")?.value
  : null;
const __velarFoundationConsole = globalThis.console ?? null;
const __velarFoundationConsoleError = __velarFoundationConsole !== null
  ? Object.getOwnPropertyDescriptor(__velarFoundationConsole, "error")?.value ?? null
  : null;
function __velarFoundationTrace(error) {
  if (typeof __velarFoundationConsoleError !== "function" || typeof __velarFoundationReflectApply !== "function") return;
  let trace = "An unhandled VelarScript failure was reported";
  try { const stack = error.stack; if (typeof stack === "string" && stack !== "") trace = stack; } catch {}
  if (trace === "An unhandled VelarScript failure was reported") {
    try { const message = error.message; if (typeof message === "string" && message !== "") trace = message; } catch {}
  }
  try { __velarFoundationReflectApply(__velarFoundationConsoleError, __velarFoundationConsole, ["Unhandled VelarScript error report: " + trace]); } catch {}
}
function __velarEnqueue(callback) {
  if (typeof __velarFoundationQueueMicrotask !== "function" || typeof __velarFoundationReflectApply !== "function") {
    throw new TypeError("The browser queueMicrotask API is unavailable");
  }
  return __velarFoundationReflectApply(__velarFoundationQueueMicrotask, globalThis, [callback]);
}
function __velarNow() {
  if (typeof __velarFoundationDateNow !== "function" || typeof __velarFoundationReflectApply !== "function") {
    throw new TypeError("The browser Date.now API is unavailable");
  }
  return __velarFoundationReflectApply(__velarFoundationDateNow, __velarFoundationDate, []);
}
const __velarRuntimeFields = Object.freeze([
  "version", "domQueue", "watchQueue", "flushPending", "activeObserver", "errorHandlers",
  "actionFailures", "unhandledFailures", "lookSources", "classSources", "dependencies", "rawToProxy", "proxyToRaw",
  "versions", "parents", "toRaw", "reactive", "track", "trackDeep", "trigger", "versionOf",
  "collectionRead", "collectionTrigger", "collectionUnlink", "trackSubscribers", "runTracked", "cleanupObserver", "computed",
  "schedule", "report", "applyLook", "installLook",
]);

function __velarRuntimeCollection(value, kind) {
  try {
    if (kind === "Set") __velarGraphSetContains(value, value);
    else if (kind === "WeakSet") __velarGraphWeakSetContains(value, value);
    else __velarGraphWeakMapContains(value, value);
    return true;
  } catch { return false; }
}

function __velarReportOptions(value) {
  if (value === undefined) value = {};
  if (!value || typeof value !== "object" || __velarGraphIsList(value)
    || (__velarGraphPrototype(value) !== __velarGraphNativeObject.prototype && __velarGraphPrototype(value) !== null)
    || __velarWebErrorOwnSymbols(value).length > 0) {
    throw new TypeError("VelarScript error report options must be a record");
  }
  const allowed = __velarGraphCreateSet(["phase", "detail", "component", "unhandled"]);
  const output = { phase: "runtime", detail: "", component: "", unhandled: false };
  for (const name of __velarGraphOwnNames(value)) {
    if (!__velarGraphSetContains(allowed, name)) throw new TypeError("Unknown VelarScript error report option '" + name + "'");
    const descriptor = __velarGraphOwnDescriptor(value, name);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("VelarScript error report options cannot use accessors");
    const next = descriptor.value;
    if (name === "unhandled") {
      if (typeof next !== "boolean") throw new TypeError("VelarScript error report unhandled must be bool");
      output.unhandled = next;
    } else {
      if (typeof next !== "string") throw new TypeError("VelarScript error report " + name + " must be a string");
      const maximum = name === "phase" ? 256 : name === "component" ? 1024 : 65536;
      if (next.length > maximum) throw new RangeError("VelarScript error report " + name + " is too long");
      output[name] = next;
    }
  }
  return output;
}

function __velarCreateRuntime() {
  const runtime = Object.create(null);
  const domQueue = Object.freeze(__velarGraphCreateSet());
  const watchQueue = Object.freeze(__velarGraphCreateSet());
  const errorHandlers = Object.freeze(__velarGraphCreateSet());
  const unhandledFailures = Object.freeze(__velarGraphCreateSet());
  const actionFailures = Object.freeze(__velarGraphCreateWeakSet());
  const lookSources = Object.freeze(__velarGraphCreateWeakMap());
  const classSources = Object.freeze(__velarGraphCreateWeakMap());
  const dependencies = Object.freeze(__velarGraphCreateWeakMap());
  const rawToProxy = Object.freeze(__velarGraphCreateWeakMap());
  const proxyToRaw = Object.freeze(__velarGraphCreateWeakMap());
  const versions = Object.freeze(__velarGraphCreateWeakMap());
  const parents = Object.freeze(__velarGraphCreateWeakMap());
  const subscriptionStops = __velarGraphCreateWeakMap();
  const collectionBrands = __velarGraphCreateWeakMap();
  const iterateKey = Symbol.for("velar.reactive.iterate.v1");
  const structureKey = Symbol.for("velar.reactive.structure.v1");
  const deepKey = Symbol.for("velar.reactive.deep.v1");
  let lookImplementation = null;
  const toRaw = (value) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
    return __velarGraphWeakMapRead(proxyToRaw, value) ?? value;
  };
  const trackSubscribers = (subscribers) => {
    const observer = runtime.activeObserver;
    if (!observer || observer.stopped) return;
    __velarGraphSetInsert(subscribers, observer);
    __velarGraphSetInsert(observer.dependencies, subscribers);
  };
  const runTracked = (observer, read) => {
    const previousDependencies = observer.dependencies;
    // Every run needs a second dependency set to diff against, and an observer
    // that re-runs thousands of times per second would otherwise allocate one
    // per run. The emptied previous set is kept as the next run's buffer.
    const spare = observer.spareDependencies;
    observer.spareDependencies = null;
    observer.dependencies = spare ?? __velarGraphCreateSet();
    const previousObserver = runtime.activeObserver;
    runtime.activeObserver = observer;
    try { return read(); }
    finally {
      runtime.activeObserver = previousObserver;
      for (const subscribers of __velarGraphSetItems(previousDependencies)) {
        if (__velarGraphSetContains(observer.dependencies, subscribers)) continue;
        // A stop fires exactly when an actual removal empties the set. Firing
        // on an already-empty set would let two detaching computeds whose
        // cleanups have not yet emptied their dependency sets re-trigger each
        // other without bound.
        if (__velarGraphSetRemove(subscribers, observer) && __velarGraphSetCount(subscribers) === 0) {
          const stop = __velarGraphWeakMapRead(subscriptionStops, subscribers);
          if (stop) stop();
        }
      }
      __velarGraphSetEmpty(previousDependencies);
      observer.spareDependencies = previousDependencies;
    }
  };
  const cleanupObserver = (observer) => {
    for (const subscribers of __velarGraphSetItems(observer.dependencies)) {
      if (__velarGraphSetRemove(subscribers, observer) && __velarGraphSetCount(subscribers) === 0) {
        const stop = __velarGraphWeakMapRead(subscriptionStops, subscribers);
        if (stop) stop();
      }
    }
    __velarGraphSetEmpty(observer.dependencies);
  };
  const track = (target, key) => {
    target = toRaw(target);
    if ((typeof target !== "object" && typeof target !== "function") || target === null) return;
    let byKey = __velarGraphWeakMapRead(dependencies, target);
    if (!byKey) { byKey = __velarGraphCreateMap(); __velarGraphWeakMapWrite(dependencies, target, byKey); }
    let subscribers = __velarGraphMapRead(byKey, key);
    if (!subscribers) {
      subscribers = __velarGraphCreateSet();
      __velarGraphMapWrite(byKey, key, subscribers);
      const ownedSubscribers = subscribers;
      __velarGraphWeakMapWrite(subscriptionStops, subscribers, () => {
        if (__velarGraphMapRead(byKey, key) !== ownedSubscribers) return;
        __velarGraphMapRemove(byKey, key);
        if (__velarGraphMapCount(byKey) === 0) __velarGraphWeakMapRemove(dependencies, target);
      });
    }
    trackSubscribers(subscribers);
  };
  const notify = (target, key) => {
    const byKey = __velarGraphWeakMapRead(dependencies, target);
    const subscribers = byKey ? __velarGraphMapRead(byKey, key) : null;
    if (subscribers) for (const observer of __velarGraphSetItems(subscribers)) observer.notify();
  };
  const bump = (target) => {
    __velarGraphWeakMapWrite(versions, target, (__velarGraphWeakMapRead(versions, target) ?? 0) + 1);
  };
  const trigger = (target, key, iterate = false, structure = false, indexFrom = null, allKeys = false) => {
    target = toRaw(target);
    if ((typeof target !== "object" && typeof target !== "function") || target === null) return;
    bump(target);
    notify(target, key);
    if (allKeys || indexFrom !== null) {
      const byKey = __velarGraphWeakMapRead(dependencies, target);
      if (byKey) for (const candidate of __velarGraphMapKeyItems(byKey)) {
        if (candidate === key) continue;
        if (allKeys || (typeof candidate === "number" && candidate >= indexFrom)) notify(target, candidate);
      }
    }
    if (iterate) notify(target, iterateKey);
    if (structure) notify(target, structureKey);
    notify(target, deepKey);
    const owners = __velarGraphWeakMapRead(parents, target);
    // A mutation of an unowned value -- the overwhelmingly common case -- must
    // not pay for the cycle bookkeeping that only an ancestor walk needs.
    if (!owners) return;
    const visited = __velarGraphCreateSet();
    __velarGraphSetInsert(visited, target);
    const bubble = (current) => {
      if (__velarGraphSetContains(visited, current)) return;
      __velarGraphSetInsert(visited, current);
      bump(current);
      notify(current, deepKey);
      const next = __velarGraphWeakMapRead(parents, current);
      if (next) for (const owner of __velarGraphSetItems(next)) bubble(owner);
    };
    for (const owner of __velarGraphSetItems(owners)) bubble(owner);
  };
  const link = (child, parent) => {
    if (child === null || (typeof child !== "object" && typeof child !== "function")) return;
    linkOwner(toRaw(child), parent);
  };
  const linkOwner = (child, parent) => {
    parent = toRaw(parent);
    if (parent === null || (typeof parent !== "object" && typeof parent !== "function") || child === parent) return;
    let owners = __velarGraphWeakMapRead(parents, child);
    if (!owners) { owners = __velarGraphCreateSet(); __velarGraphWeakMapWrite(parents, child, owners); }
    __velarGraphSetInsert(owners, parent);
  };
  // Removing the last owner of a value detaches everything only that value
  // owned. Without the cascade, replacing a state root leaves every surviving
  // descendant pointing at the dead root: the root stays strongly reachable
  // and each later deep mutation walks one more generation.
  const release = (root) => {
    const pending = [root];
    let index = 0;
    while (index < pending.length) {
      const current = pending[index];
      index += 1;
      forEachOwnedValue(current, (value) => {
        const owners = __velarGraphWeakMapRead(parents, value);
        if (!owners || !__velarGraphSetContains(owners, current)) return;
        __velarGraphSetRemove(owners, current);
        if (__velarGraphSetCount(owners) > 0) return;
        __velarGraphWeakMapRemove(parents, value);
        pending[pending.length] = value;
      });
    }
  };
  const unlink = (child, parent) => {
    child = toRaw(child);
    parent = toRaw(parent);
    const owners = child !== null && (typeof child === "object" || typeof child === "function")
      ? __velarGraphWeakMapRead(parents, child)
      : null;
    if (!owners) return;
    __velarGraphSetRemove(owners, parent);
    if (__velarGraphSetCount(owners) > 0) return;
    __velarGraphWeakMapRemove(parents, child);
    release(child);
  };
  // Map and Set membership is decided once per value and remembered: the only
  // cross-realm test JavaScript offers is invoking a prototype accessor and
  // catching, and a record write must not pay two thrown exceptions per field.
  const collectionBrand = (value) => {
    const known = __velarGraphWeakMapRead(collectionBrands, value);
    if (known !== undefined) return known;
    let brand = 0;
    try { __velarGraphMapCount(value); brand = 1; }
    catch {
      try { __velarGraphSetCount(value); brand = 2; }
      catch { brand = 0; }
    }
    __velarGraphWeakMapWrite(collectionBrands, value, brand);
    return brand;
  };
  const forEachOwnedValue = (parent, visit) => {
    if (parent === null || (typeof parent !== "object" && typeof parent !== "function")) return;
    if (__velarGraphIsList(parent)) {
      for (let index = 0; index < parent.length; index += 1) {
        const value = toRaw(__velarGraphOwnDescriptor(parent, index)?.value);
        if (value !== null && (typeof value === "object" || typeof value === "function")) visit(value);
      }
      return;
    }
    const brand = collectionBrand(parent);
    if (brand === 1) {
      for (const value of __velarGraphMapItems(parent)) {
        const owned = toRaw(value);
        if (owned !== null && (typeof owned === "object" || typeof owned === "function")) visit(owned);
      }
      // A Map key is linked to its Map exactly like a value, so releasing the
      // Map has to release object keys too.
      for (const value of __velarGraphMapKeyItems(parent)) {
        const owned = toRaw(value);
        if (owned !== null && (typeof owned === "object" || typeof owned === "function")) visit(owned);
      }
      return;
    }
    if (brand === 2) {
      for (const value of __velarGraphSetItems(parent)) {
        const owned = toRaw(value);
        if (owned !== null && (typeof owned === "object" || typeof owned === "function")) visit(owned);
      }
      return;
    }
    if (typeof parent !== "object") return;
    for (const name of __velarGraphOwnNames(parent)) {
      const descriptor = __velarGraphOwnDescriptor(parent, name);
      if (!descriptor || !("value" in descriptor)) continue;
      const value = toRaw(descriptor.value);
      if (value !== null && (typeof value === "object" || typeof value === "function")) visit(value);
    }
  };
  const contains = (parent, child) => {
    parent = toRaw(parent);
    child = toRaw(child);
    if (__velarGraphIsList(parent)) {
      for (let index = 0; index < parent.length; index += 1) {
        if (toRaw(__velarGraphOwnDescriptor(parent, index)?.value) === child) return true;
      }
      return false;
    }
    const brand = collectionBrand(parent);
    if (brand === 1) {
      for (const value of __velarGraphMapItems(parent)) if (toRaw(value) === child) return true;
      return false;
    }
    if (brand === 2) {
      for (const value of __velarGraphSetItems(parent)) if (toRaw(value) === child) return true;
      return false;
    }
    if (!parent || typeof parent !== "object") return false;
    for (const name of __velarGraphOwnNames(parent)) {
      const descriptor = __velarGraphOwnDescriptor(parent, name);
      if (descriptor && "value" in descriptor && toRaw(descriptor.value) === child) return true;
    }
    return false;
  };
  // The one guard every detach path shares: a primitive was never linked, and
  // an object with no owners has nothing to release, so neither may reach the
  // O(fields) containment scan.
  const releaseChild = (parent, child) => {
    if (child === null || (typeof child !== "object" && typeof child !== "function")
      || !__velarGraphWeakMapContains(parents, child)) return;
    if (!contains(parent, child)) unlink(child, parent);
  };
  const reactive = (value, parent = null) => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
    value = toRaw(value);
    if (parent !== null) linkOwner(value, parent);
    if (typeof value !== "object" || __velarGraphIsList(value) || !__velarGraphIsExtensible(value)) return value;
    const prototype = __velarGraphPrototype(value);
    if (prototype !== __velarGraphNativeObject.prototype && prototype !== null) return value;
    let proxy = __velarGraphWeakMapRead(rawToProxy, value);
    if (proxy) return proxy;
    proxy = new __velarGraphNativeProxy(value, {
      get(target, key) {
        track(target, key);
        return reactive(__velarGraphGet(target, key, target), target);
      },
      set(target, key, next) {
        next = toRaw(next);
        const present = __velarGraphHas(target, key);
        const previous = toRaw(__velarGraphGet(target, key, target));
        // Creating an absent key is a structural change even when the value
        // written equals the absent key's 'undefined' reading.
        const changed = !present || !__velarGraphSame(previous, next);
        const written = __velarGraphSet(target, key, next, target);
        if (!written || !changed) return written;
        link(next, target);
        releaseChild(target, previous);
        trigger(target, key, true, !present);
        return true;
      },
      has(target, key) { track(target, key); return __velarGraphHas(target, key); },
      deleteProperty(target, key) {
        if (!__velarGraphHas(target, key)) return true;
        const previous = toRaw(__velarGraphGet(target, key, target));
        const deleted = __velarGraphDelete(target, key);
        if (deleted) {
          releaseChild(target, previous);
          trigger(target, key, true, true);
        }
        return deleted;
      },
    });
    __velarGraphWeakMapWrite(rawToProxy, value, proxy);
    __velarGraphWeakMapWrite(proxyToRaw, proxy, value);
    return proxy;
  };
  const trackDeep = (value) => { value = toRaw(value); track(value, deepKey); return value; };
  const versionOf = (value) => {
    value = toRaw(value);
    return value && (typeof value === "object" || typeof value === "function")
      ? __velarGraphWeakMapRead(versions, value) ?? 0
      : 0;
  };
  const collectionRead = (value, key, child) => {
    value = toRaw(value);
    track(value, key);
    // Only containers already connected to a state graph own children read
    // through them. Fresh derived Lists (filter/map/etc.) stay ephemeral and
    // cannot become strongly retained parents of every item merely by being
    // iterated during rendering.
    return reactive(child, __velarGraphWeakMapContains(parents, value) ? value : null);
  };
  const collectionTrigger = (value, key, iterate = true, structure = false, indexFrom = null, allKeys = false) => trigger(toRaw(value), key, iterate, structure, indexFrom, allKeys);
  const collectionUnlink = (value, child) => {
    releaseChild(toRaw(value), toRaw(child));
  };
  const computed = (read) => {
    if (typeof read !== "function") throw new TypeError("computed requires a function");
    let dirty = true;
    let evaluating = false;
    let recursed = false;
    let initialized = false;
    let value;
    let failed = false;
    let failure;
    const subscribers = __velarGraphCreateSet();
    const notifyDependents = (skip = null) => {
      for (const dependent of __velarGraphSetItems(subscribers)) if (dependent !== skip) dependent.notify();
    };
    const invalidateComputedDependents = () => {
      for (const dependent of __velarGraphSetItems(subscribers)) {
        if (dependent.mode === "computed") dependent.notify();
      }
    };
    const observer = {
      mode: "computed",
      stopped: false,
      running: false,
      selfInvalidations: 0,
      dependencies: __velarGraphCreateSet(),
      notify() {
        // Stopping is shared discipline with DOM and watch observers: a flush
        // overflow marks queued computed observers stopped, and a stopped
        // observer must go inert instead of re-entering the storm on the next
        // write.
        if (observer.stopped) return;
        // The 100 self-invalidation cap covers computed observers too. A
        // computed whose own turn (evaluation plus dependent notification)
        // keeps invalidating it is stopped with the same owned report a
        // render or watch observer gets, instead of running to the whole
        // flush budget.
        if (observer.running) {
          observer.selfInvalidations += 1;
          if (observer.selfInvalidations > 100) {
            observer.stopped = true;
            cleanupObserver(observer);
            reportUntracked(new RangeError("A computed value cannot invalidate itself more than 100 times"));
            return;
          }
        } else {
          observer.selfInvalidations = 0;
        }
        if (dirty) return;
        dirty = true;
        if (__velarGraphSetCount(subscribers) === 0) {
          cleanupObserver(observer);
          return;
        }
        schedule(observer);
        // A downstream computed must become dirty immediately so a same-turn
        // read cannot observe its cached result while an upstream dependency
        // is already stale. DOM and watch observers still wait for evaluation
        // to prove that the public result actually changed.
        invalidateComputedDependents();
      },
      run() {
        if (observer.stopped || !dirty || __velarGraphSetCount(subscribers) === 0) return;
        observer.running = true;
        try {
          if (evaluate(false)) notifyDependents();
        } finally { observer.running = false; }
      },
    };
    const detach = () => {
      cleanupObserver(observer);
      dirty = true;
    };
    __velarGraphWeakMapWrite(subscriptionStops, subscribers, detach);
    const evaluate = (throwFailure) => {
      if (evaluating) {
        recursed = true;
        throw new RangeError("A computed value cannot read itself recursively");
      }
      const previous = value;
      const previouslyFailed = failed;
      const previousFailure = failure;
      const hadValue = initialized;
      evaluating = true;
      recursed = false;
      failed = false;
      failure = undefined;
      try { value = runTracked(observer, read); }
      catch (error) { failed = true; failure = error; }
      finally {
        evaluating = false;
        initialized = true;
        dirty = false;
      }
      // A computed that failed because its own recursion guard tripped sits on
      // a dependency cycle. The failure is cached and served, but the cyclic
      // edges must not persist: two failed computeds that keep notifying each
      // other would otherwise ping-pong the next flush into the whole-flush
      // budget. Detaching unwinds the cycle (a peer whose last subscriber
      // leaves detaches with it) and a later read simply re-attempts.
      if (failed && recursed) detach();
      else if (__velarGraphSetCount(subscribers) === 0) detach();
      recursed = false;
      const changed = !hadValue || previouslyFailed !== failed || (failed ? previousFailure !== failure : !__velarGraphSame(previous, value));
      if (throwFailure && failed) throw failure;
      return changed;
    };
    const access = () => {
      const consumer = runtime.activeObserver;
      if (consumer !== observer) trackSubscribers(subscribers);
      if (dirty && !observer.stopped) {
        // A cyclic read re-enters access while the outer evaluation is still
        // running, so the running span is restored, never cleared.
        const wasRunning = observer.running;
        observer.running = true;
        try {
          const changed = evaluate(false);
          if (changed && initialized) notifyDependents(consumer);
        } finally { observer.running = wasRunning; }
      }
      if (failed) throw failure;
      return value;
    };
    return __velarGraphFreeze(access);
  };
  // The loud channel for a failure nothing owns. In a browser the microtask
  // throw reaches the host error event and the page survives it; in a
  // non-browser host (a headless 'velar test' process, a worker) the same
  // throw terminates the process, which is the program termination the
  // runtime boundary forbids. There the failure is traced to the console and
  // parked so the next tick() fails its awaiting caller instead.
  const escalate = (error) => {
    if (__velarDomDocument !== null) {
      __velarEnqueue(() => { throw error; });
      return;
    }
    if (__velarGraphSetCount(unhandledFailures) < 100) __velarGraphSetInsert(unhandledFailures, error);
    __velarFoundationTrace(error);
  };
  const report = (value, options) => {
    const error = __velarNormalizeError(value);
    const checked = __velarReportOptions(options);
    const timestamp = __velarNow();
    if (!__velarWebErrorFinite(timestamp)) throw new TypeError("The browser returned an invalid error timestamp");
    const errorReport = __velarWebErrorFreeze({
      error,
      phase: checked.phase,
      detail: checked.detail,
      component: checked.component,
      timestamp,
    });
    let handled = false;
    for (const handler of __velarGraphSetItems(errorHandlers)) {
      handled = true;
      try {
        const result = handler(errorReport);
        __velarObservePromise(result, (failure) => escalate(__velarNormalizeError(failure)));
      } catch (failure) { escalate(__velarNormalizeError(failure)); }
    }
    if (checked.unhandled && !handled) escalate(error);
    return errorReport;
  };
  // A report raised from inside a tracked evaluation (the computed cap) must
  // not let handler reads become dependencies of the failing observer.
  const reportUntracked = (error) => {
    const previousObserver = runtime.activeObserver;
    runtime.activeObserver = null;
    try { report(error, { phase: "update", detail: "", component: "", unhandled: true }); }
    finally { runtime.activeObserver = previousObserver; }
  };
  // The scheduler lives on the runtime registry itself: computed observers are
  // created by whichever module stamped the registry first (velar/app under
  // ESM import order, or the application prelude), and their notifications
  // must schedule correctly no matter which module that was. The emitted
  // application prelude keeps its own identical drain for the observers it
  // creates; the shared flushPending flag keeps exactly one flush microtask
  // enqueued whichever side scheduled first, and either drain runs every
  // queued observer.
  const scheduleFlush = () => {
    if (runtime.flushPending) return;
    runtime.flushPending = true;
    __velarEnqueue(flush);
  };
  const flushOverflow = () => {
    const stalled = [];
    for (const observer of __velarGraphSetItems(domQueue)) stalled[stalled.length] = observer;
    for (const observer of __velarGraphSetItems(watchQueue)) stalled[stalled.length] = observer;
    __velarGraphSetEmpty(domQueue);
    __velarGraphSetEmpty(watchQueue);
    for (let index = 0; index < stalled.length; index += 1) {
      const observer = stalled[index];
      if (typeof observer.stop === "function") observer.stop();
      else observer.stopped = true;
    }
    report(new RangeError("Reactive updates cannot run more than 100000 observers in one flush"), { phase: "update", detail: "", component: "", unhandled: true });
  };
  const flush = () => {
    runtime.flushPending = false;
    let budget = 100000;
    for (const observer of __velarGraphSetItems(domQueue)) {
      __velarGraphSetRemove(domQueue, observer);
      if ((budget -= 1) < 0) { flushOverflow(); return; }
      observer.run();
    }
    for (const observer of __velarGraphSetItems(watchQueue)) {
      __velarGraphSetRemove(watchQueue, observer);
      if ((budget -= 1) < 0) { flushOverflow(); return; }
      observer.run();
    }
    if (__velarGraphSetCount(domQueue) || __velarGraphSetCount(watchQueue)) scheduleFlush();
  };
  const schedule = (observer) => {
    const queue = observer.mode === "watch" ? watchQueue : domQueue;
    if (!__velarGraphSetContains(queue, observer) && __velarGraphSetCount(queue) >= 100000) throw new RangeError("VelarScript reactive queues cannot exceed 100000 observers");
    __velarGraphSetInsert(queue, observer);
    scheduleFlush();
  };
  const applyLook = (...arguments_) => {
    if (!lookImplementation) throw new TypeError("Link Look requires the VelarScript Web runtime");
    return lookImplementation(...arguments_);
  };
  const installLook = (implementation) => {
    if (typeof implementation !== "function") throw new TypeError("VelarScript Look integration requires a function");
    lookImplementation ??= implementation;
    return null;
  };
  const fields = {
    version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}, domQueue, watchQueue, flushPending: false, activeObserver: null, errorHandlers,
    actionFailures, unhandledFailures, lookSources, classSources, dependencies, rawToProxy, proxyToRaw, versions, parents,
    toRaw, reactive, track, trackDeep, trigger, versionOf, collectionRead, collectionTrigger, collectionUnlink,
    trackSubscribers, runTracked, cleanupObserver, computed,
    schedule, report, applyLook, installLook,
  };
  for (const name of __velarRuntimeFields) Object.defineProperty(runtime, name, {
    value: fields[name],
    enumerable: false,
    configurable: false,
    writable: name === "flushPending" || name === "activeObserver",
  });
  return Object.preventExtensions(runtime);
}

function __velarRequireRuntime(value) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== null || Object.isExtensible(value)
    || Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("VelarScript Web runtime ownership is invalid");
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== __velarRuntimeFields.length || __velarRuntimeFields.some((name) => !names.includes(name))) {
    throw new TypeError("VelarScript Web runtime fields are invalid");
  }
  for (const name of __velarRuntimeFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    const mutable = name === "flushPending" || name === "activeObserver";
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable !== mutable) {
      throw new TypeError("VelarScript Web runtime field '" + name + "' is invalid");
    }
  }
  if (value.version !== ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}
    || !__velarRuntimeCollection(value.domQueue, "Set") || !__velarRuntimeCollection(value.watchQueue, "Set")
    || typeof value.flushPending !== "boolean" || (value.activeObserver !== null && typeof value.activeObserver !== "object")
    || !__velarRuntimeCollection(value.errorHandlers, "Set") || !__velarRuntimeCollection(value.actionFailures, "WeakSet")
    || !__velarRuntimeCollection(value.unhandledFailures, "Set")
    || !__velarRuntimeCollection(value.lookSources, "WeakMap") || !__velarRuntimeCollection(value.classSources, "WeakMap")
    || !__velarRuntimeCollection(value.dependencies, "WeakMap") || !__velarRuntimeCollection(value.rawToProxy, "WeakMap")
    || !__velarRuntimeCollection(value.proxyToRaw, "WeakMap") || !__velarRuntimeCollection(value.versions, "WeakMap")
    || !__velarRuntimeCollection(value.parents, "WeakMap")
    || typeof value.toRaw !== "function" || typeof value.reactive !== "function" || typeof value.track !== "function"
    || typeof value.trackDeep !== "function" || typeof value.trigger !== "function" || typeof value.versionOf !== "function"
    || typeof value.collectionRead !== "function" || typeof value.collectionTrigger !== "function" || typeof value.collectionUnlink !== "function"
    || typeof value.trackSubscribers !== "function" || typeof value.runTracked !== "function"
    || typeof value.cleanupObserver !== "function" || typeof value.computed !== "function" || typeof value.schedule !== "function"
    || typeof value.report !== "function" || typeof value.applyLook !== "function" || typeof value.installLook !== "function") {
    throw new TypeError("VelarScript Web runtime values are invalid");
  }
  return value;
}

const __velarRuntime = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarRuntimeKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) {
      throw new TypeError("VelarScript Web runtime registry ownership is invalid");
    }
    return __velarRequireRuntime(descriptor.value);
  }
  const runtime = __velarCreateRuntime();
  Object.defineProperty(globalThis, __velarRuntimeKey, {
    value: runtime,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return runtime;
})();
`.trimStart();
}

export const WEB_RUNTIME_FOUNDATION = webRuntimeFoundation(WEB_ERROR_HOST_RUNTIME);
export const WEB_RUNTIME_FOUNDATION_SHARED_ERROR = webRuntimeFoundation(WEB_ERROR_HOST_RUNTIME_BODY);
