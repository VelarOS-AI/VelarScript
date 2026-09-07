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
const __velarDomElementNamespaceURI = __velarDomPrototypeMember(__velarDomNativeElement, "namespaceURI", "get");
const __velarDomNodeChildNodes = __velarDomPrototypeMember(__velarDomNativeNode, "childNodes", "get");
const __velarDomNodeInsertBefore = __velarDomPrototypeMember(__velarDomNativeNode, "insertBefore");
const __velarDomNodeReplaceChildren = __velarDomPrototypeMember(__velarDomNativeNode, "replaceChildren");
const __velarDomNodeAppend = __velarDomPrototypeMember(__velarDomNativeNode, "append");
const __velarDomNodeTextContentSet = __velarDomPrototypeMember(__velarDomNativeNode, "textContent", "set");
const __velarDomCharacterDataDataSet = __velarDomPrototypeMember(__velarDomNativeCharacterData, "data", "set");
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
// The in-place text update. A scalar interpolation owns one text node for its
// whole life and rewrites its character data rather than replacing the node, so
// 'data' joins the captured accessor ABI beside 'innerHTML' and 'value': a
// planted CharacterData.prototype setter must not be able to observe or divert
// what the framework writes into its own node.
function __velarDomSetData(value, next) {
  return __velarDomNodeAccessor(value, "data", [[__velarDomNativeCharacterData, __velarDomCharacterDataDataSet]], [next], true);
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
// WB-U1: which document a node belongs to, read the way every other host field
// here is read. The root fatal state needs it because the position it replaces
// is a mount target the program named at runtime -- unlike a region, whose
// namespace the lowering already knows -- and an HTML '<section>' inside
// '<svg>' is content a browser lays out none of.
function __velarDomNamespace(value) {
  if (__velarDomInstance(value, __velarDomNativeElement) && typeof __velarDomElementNamespaceURI === "function") {
    const namespace = __velarDomApply(__velarDomElementNamespaceURI, value, [], "Element.namespaceURI");
    return typeof namespace === "string" ? namespace : null;
  }
  const namespace = __velarDomOwnData(value, "namespaceURI");
  return typeof namespace === "string" ? namespace : null;
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
