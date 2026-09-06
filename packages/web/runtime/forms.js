const NativeFormElement = typeof globalThis.HTMLFormElement === "function" ? globalThis.HTMLFormElement : null;
const NativeFormData = typeof globalThis.FormData === "function" ? globalThis.FormData : null;
const NativeFormMap = typeof globalThis.Map === "function" ? globalThis.Map : null;
const NativeFormWeakMap = typeof globalThis.WeakMap === "function" ? globalThis.WeakMap : null;
const NativeFormNumber = typeof globalThis.Number === "function" ? globalThis.Number : null;
const NativeFormNode = typeof globalThis.Node === "function" ? globalThis.Node : null;
const NativeFormElementBase = typeof globalThis.Element === "function" ? globalThis.Element : null;
const NativeFormHtmlElement = typeof globalThis.HTMLElement === "function" ? globalThis.HTMLElement : null;
const NativeFormDocumentConstructor = typeof globalThis.Document === "function" ? globalThis.Document : null;
const NativeFormDocument = globalThis.document ?? null;
const NativeFormHtmlCollection = typeof globalThis.HTMLCollection === "function" ? globalThis.HTMLCollection : null;
const NativeFormNodeList = typeof globalThis.NodeList === "function" ? globalThis.NodeList : null;
const NativeFormInput = typeof globalThis.HTMLInputElement === "function" ? globalThis.HTMLInputElement : null;
const NativeFormButton = typeof globalThis.HTMLButtonElement === "function" ? globalThis.HTMLButtonElement : null;
const NativeFormSelect = typeof globalThis.HTMLSelectElement === "function" ? globalThis.HTMLSelectElement : null;
const NativeFormTextArea = typeof globalThis.HTMLTextAreaElement === "function" ? globalThis.HTMLTextAreaElement : null;
const NativeFormFieldSet = typeof globalThis.HTMLFieldSetElement === "function" ? globalThis.HTMLFieldSetElement : null;
const NativeFormOptGroup = typeof globalThis.HTMLOptGroupElement === "function" ? globalThis.HTMLOptGroupElement : null;
const NativeFormOption = typeof globalThis.HTMLOptionElement === "function" ? globalThis.HTMLOptionElement : null;
const formReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const formHasInstance = Object.getOwnPropertyDescriptor(Function.prototype, Symbol.hasInstance)?.value;
const formGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const formDefineProperty = Object.getOwnPropertyDescriptor(Object, "defineProperty")?.value;
const formDataGet = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "get")?.value : null;
const formDataGetAll = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "getAll")?.value : null;
const formDataHas = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "has")?.value : null;
const formDataForEach = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "forEach")?.value : null;
const formMapGet = typeof NativeFormMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormMap.prototype, "get")?.value : null;
const formMapHas = typeof NativeFormMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormMap.prototype, "has")?.value : null;
const formMapSet = typeof NativeFormMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormMap.prototype, "set")?.value : null;
const formWeakMapGet = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "get")?.value : null;
const formWeakMapHas = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "has")?.value : null;
const formWeakMapSet = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "set")?.value : null;
const formWeakMapDelete = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "delete")?.value : null;
const formStringTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim")?.value;
const formRegexTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")?.value;
const formRegexSplit = Object.getOwnPropertyDescriptor(RegExp.prototype, Symbol.split)?.value;
const formArrayJoin = Object.getOwnPropertyDescriptor(Array.prototype, "join")?.value;
const formNumberIsFinite = Object.getOwnPropertyDescriptor(Number, "isFinite")?.value;
const formNumberIsSafeInteger = Object.getOwnPropertyDescriptor(Number, "isSafeInteger")?.value;
const formElementOwner = NativeFormElementBase ?? NativeFormElement;
const formHtmlOwner = NativeFormHtmlElement ?? NativeFormElement;
const formDocumentCreateElement = typeof NativeFormDocumentConstructor === "function"
  ? Object.getOwnPropertyDescriptor(NativeFormDocumentConstructor.prototype, "createElement")?.value
  : NativeFormDocument && typeof NativeFormDocument === "object" ? Object.getOwnPropertyDescriptor(NativeFormDocument, "createElement")?.value : null;
const formElementGetAttribute = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "getAttribute")?.value : null;
const formElementSetAttribute = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "setAttribute")?.value : null;
const formElementRemoveAttribute = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "removeAttribute")?.value : null;
const formElementInsertAdjacentElement = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "insertAdjacentElement")?.value : null;
const formElementRemove = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "remove")?.value : null;
const formElementQuerySelector = typeof formElementOwner === "function"
  ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "querySelector")?.value ?? Object.getOwnPropertyDescriptor(NativeFormElement?.prototype ?? {}, "querySelector")?.value : null;
const formElementQuerySelectorAll = typeof formElementOwner === "function"
  ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "querySelectorAll")?.value ?? Object.getOwnPropertyDescriptor(NativeFormElement?.prototype ?? {}, "querySelectorAll")?.value : null;
const formHtmlFocus = typeof formHtmlOwner === "function" ? Object.getOwnPropertyDescriptor(formHtmlOwner.prototype, "focus")?.value : null;
const formNativeReset = typeof NativeFormElement === "function" ? Object.getOwnPropertyDescriptor(NativeFormElement.prototype, "reset")?.value : null;
const formElementsGet = typeof NativeFormElement === "function" ? Object.getOwnPropertyDescriptor(NativeFormElement.prototype, "elements")?.get : null;
const formCollectionLengthGet = typeof NativeFormHtmlCollection === "function" ? Object.getOwnPropertyDescriptor(NativeFormHtmlCollection.prototype, "length")?.get : null;
const formCollectionItem = typeof NativeFormHtmlCollection === "function" ? Object.getOwnPropertyDescriptor(NativeFormHtmlCollection.prototype, "item")?.value : null;
const formNodeListLengthGet = typeof NativeFormNodeList === "function" ? Object.getOwnPropertyDescriptor(NativeFormNodeList.prototype, "length")?.get : null;
const formNodeListItem = typeof NativeFormNodeList === "function" ? Object.getOwnPropertyDescriptor(NativeFormNodeList.prototype, "item")?.value : null;
const formNodeTextContent = typeof NativeFormNode === "function" ? Object.getOwnPropertyDescriptor(NativeFormNode.prototype, "textContent") : null;
const formElementId = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "id") : null;
const formControlContracts = [
  NativeFormInput, NativeFormButton, NativeFormSelect, NativeFormTextArea, NativeFormFieldSet, NativeFormOptGroup, NativeFormOption,
].map((constructor) => constructor && typeof constructor === "function" ? {
  constructor,
  name: Object.getOwnPropertyDescriptor(constructor.prototype, "name") ?? null,
  disabled: Object.getOwnPropertyDescriptor(constructor.prototype, "disabled") ?? null,
} : null);
let nextErrorId = 1;
const pendingFields = typeof NativeFormWeakMap === "function" ? new NativeFormWeakMap() : null;
const maxFormFields = 100000;
const maxFormTextCodeUnits = 16 * 1024 * 1024;
function formText(value, name, maximum = 1024) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function formCall(operation, receiver, arguments_, name) {
  if (typeof operation !== "function" || typeof formReflectApply !== "function") {
    throw new TypeError("The browser does not expose native " + name);
  }
  return formReflectApply(operation, receiver, arguments_);
}
function formInstance(constructor, value) {
  if (typeof constructor !== "function" || typeof formHasInstance !== "function" || typeof formReflectApply !== "function") return false;
  try { return formReflectApply(formHasInstance, constructor, [value]); } catch { return false; }
}
function formOwnDescriptor(value, name) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null
    || typeof formGetOwnPropertyDescriptor !== "function" || typeof formReflectApply !== "function") return null;
  return formReflectApply(formGetOwnPropertyDescriptor, __velarOptionsNativeObject, [value, name]);
}
function formHostMethod(operation, owner, receiver, arguments_, name) {
  if (formInstance(owner, receiver)) return formCall(operation, receiver, arguments_, name);
  const descriptor = formOwnDescriptor(receiver, name);
  if (descriptor?.enumerable && "value" in descriptor && typeof descriptor.value === "function") {
    return formCall(descriptor.value, receiver, arguments_, name);
  }
  throw new TypeError("The browser does not expose native " + name);
}
function formHostRead(descriptor, owner, receiver, name) {
  if (formInstance(owner, receiver) && typeof descriptor?.get === "function") return formCall(descriptor.get, receiver, [], name);
  const own = formOwnDescriptor(receiver, name);
  if (own?.enumerable && "value" in own) return own.value;
  throw new TypeError("The browser does not expose a data-only " + name);
}
function formHostWrite(descriptor, owner, receiver, name, value) {
  if (formInstance(owner, receiver) && typeof descriptor?.set === "function") {
    formCall(descriptor.set, receiver, [value], name);
    return;
  }
  const own = formOwnDescriptor(receiver, name);
  if (!own?.enumerable || !("value" in own) || !own.writable || typeof formDefineProperty !== "function") {
    throw new TypeError("The browser does not expose a writable data-only " + name);
  }
  formReflectApply(formDefineProperty, __velarOptionsNativeObject, [receiver, name, {...own, value}]);
}
function formControlContract(value, field, writing = false) {
  for (let index = 0; index < formControlContracts.length; index += 1) {
    const contract = formControlContracts[index];
    if (!contract || !formInstance(contract.constructor, value)) continue;
    const descriptor = contract[field];
    if (writing ? typeof descriptor?.set === "function" : typeof descriptor?.get === "function") return [contract.constructor, descriptor];
    throw new TypeError("The browser form control does not expose native " + field);
  }
  return [null, null];
}
function formControlRead(value, field) {
  const [owner, descriptor] = formControlContract(value, field, false);
  return formHostRead(descriptor, owner, value, field);
}
function formControlWrite(value, field, item) {
  const [owner, descriptor] = formControlContract(value, field, true);
  formHostWrite(descriptor, owner, value, field, item);
}
function formSnapshotCollection(value, name, maximum) {
  if (__velarListReflectApply(__velarListArrayIsArray, __velarListNativeArray, [value])) {
    const output = __velarRequireList(value, name);
    if (output.length > maximum) throw new RangeError(name + " cannot exceed " + maximum + " items");
    return output;
  }
  let count;
  let itemOperation;
  if (formInstance(NativeFormHtmlCollection, value)) {
    count = formCall(formCollectionLengthGet, value, [], "HTMLCollection.length");
    itemOperation = formCollectionItem;
  } else if (formInstance(NativeFormNodeList, value)) {
    count = formCall(formNodeListLengthGet, value, [], "NodeList.length");
    itemOperation = formNodeListItem;
  } else {
    const length = formOwnDescriptor(value, "length");
    if (!length?.enumerable || !("value" in length)) throw new TypeError(name + " requires a bounded data-only collection");
    count = length.value;
  }
  if (typeof formNumberIsSafeInteger !== "function" || !formReflectApply(formNumberIsSafeInteger, NativeFormNumber, [count]) || count < 0) {
    throw new TypeError(name + " has an invalid length");
  }
  if (count > maximum) throw new RangeError(name + " cannot exceed " + maximum + " items");
  const output = new __velarListNativeArray(count);
  for (let index = 0; index < count; index += 1) {
    let item;
    if (typeof itemOperation === "function") item = formCall(itemOperation, value, [index], name + ".item");
    else {
      const descriptor = formOwnDescriptor(value, index);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " requires data-only indexed values");
      item = descriptor.value;
    }
    formListSet(output, index, item);
  }
  return output;
}
function formGetAttribute(element, name) { return formHostMethod(formElementGetAttribute, formElementOwner, element, [name], "getAttribute"); }
function formSetAttribute(element, name, value) { return formHostMethod(formElementSetAttribute, formElementOwner, element, [name, value], "setAttribute"); }
function formRemoveAttribute(element, name) { return formHostMethod(formElementRemoveAttribute, formElementOwner, element, [name], "removeAttribute"); }
function formAttributeTokens(value) {
  value = formText(value, "Form accessibility metadata", 65536);
  if (!value) return new __velarListNativeArray();
  const raw = formCall(formRegexSplit, /\s+/u, [value], "RegExp split");
  const input = __velarRequireList(raw, "Form accessibility metadata tokens");
  const output = new __velarListNativeArray();
  const seen = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!seen) throw new TypeError("The browser Map API is unavailable");
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (!token || formCall(formMapHas, seen, [token], "Map.has")) continue;
    formCall(formMapSet, seen, [token, true], "Map.set");
    formListSet(output, output.length, token);
  }
  return output;
}
function formJoinTokens(tokens) { return formCall(formArrayJoin, tokens, [" "], "Array.join"); }
function formData(form) {
  if (typeof NativeFormData !== "function") throw new TypeError("The browser FormData API is unavailable");
  return new NativeFormData(form);
}
function formListSet(values, index, value) {
  __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [values, index, {
    value, enumerable: true, configurable: true, writable: true,
  }]);
}
function formNumber(value) {
  if (typeof value !== "string") return null;
  if (typeof NativeFormNumber !== "function" || typeof formNumberIsFinite !== "function") {
    throw new TypeError("The browser number parsing intrinsics are unavailable");
  }
  const text = formCall(formStringTrim, value, [], "String.trim");
  if (!formCall(formRegexTest, /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u, [text], "RegExp.test")) return null;
  const number = formReflectApply(NativeFormNumber, undefined, [text]);
  return formReflectApply(formNumberIsFinite, NativeFormNumber, [number]) ? number : null;
}
function formValue(value, name) {
  if (typeof value === "string" && value.length > maxFormTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
  return value;
}
function formList(values, name) {
  const output = __velarRequireList(values, name);
  if (output.length > maxFormFields) throw new RangeError(name + " cannot exceed 100000 values");
  return output;
}
function formElements(form) {
  const elements = formHostRead({get: formElementsGet}, NativeFormElement, form, "elements");
  return formSnapshotCollection(elements, "Form controls", maxFormFields);
}
function formErrorNodes(form) {
  const nodes = formHostMethod(formElementQuerySelectorAll, formElementOwner, form, ["[data-velar-field-error]"], "querySelectorAll");
  return formSnapshotCollection(nodes, "Form field errors", maxFormFields);
}
function formType(value) { return __velarRequireRuntimeType(value, "Form reading"); }
function decoderField(value) {
  value = __velarOptions(value, "Form decoder field", __velarOptionFields(["name", "kind", "optional", "enumValues"]));
  const name = formText(value.name, "Form decoder field name");
  const kind = formText(value.kind, "Form decoder field kind", 64);
  if (kind !== "string" && kind !== "number" && kind !== "bool" && kind !== "enum" && kind !== "strings") {
    throw new TypeError("Form decoder field '" + name + "' uses an unsupported decoder");
  }
  if (typeof value.optional !== "boolean") throw new TypeError("Form decoder optional must be bool");
  let enumValues = null;
  if (kind === "enum") {
    enumValues = __velarRequireList(value.enumValues, "Form enum values");
    if (enumValues.length > maxFormFields) throw new RangeError("Form enum values cannot exceed 100000 entries");
    for (let index = 0; index < enumValues.length; index += 1) {
      if (typeof enumValues[index] !== "string") throw new TypeError("Form enum values must be strings");
    }
  } else if (value.enumValues != null) {
    throw new TypeError("Only enum form decoders can declare enum values");
  }
  return __velarFreezeOptionsValue({ name, kind, optional: value.optional, enumValues });
}

export function values(form) {
  requireForm(form);
  if (typeof NativeFormMap !== "function") throw new TypeError("The browser Map API is unavailable");
  const output = new NativeFormMap();
  let count = 0;
  const data = formData(form);
  formCall(formDataForEach, data, [(value, name) => {
    count += 1;
    if (count > maxFormFields) throw new RangeError("Forms cannot exceed 100000 submitted fields");
    const checkedName = formText(name, "Submitted form field name");
    formValue(value, "Form field '" + checkedName + "'");
    if (!formCall(formMapHas, output, [checkedName], "Map.has")) formCall(formMapSet, output, [checkedName, value], "Map.set");
    else {
      const current = formCall(formMapGet, output, [checkedName], "Map.get");
      if (__velarListReflectApply(__velarListArrayIsArray, __velarListNativeArray, [current])) {
        formListSet(current, current.length, value);
      } else {
        const repeated = new __velarListNativeArray(2);
        formListSet(repeated, 0, current);
        formListSet(repeated, 1, value);
        formCall(formMapSet, output, [checkedName, repeated], "Map.set");
      }
    }
  }], "FormData.forEach");
  return output;
}

export function read(form, type, fields) {
  requireForm(form);
  type = formType(type);
  const decoderItems = __velarRequireList(fields, "Form decoder fields");
  if (decoderItems.length > maxFormFields) throw new RangeError("Form decoders cannot exceed 100000 fields");
  fields = decoderItems;
  for (let index = 0; index < fields.length; index += 1) fields[index] = decoderField(fields[index]);
  const data = formData(form);
  const output = __velarOptionsReflectApply(__velarOptionsCreate, __velarOptionsNativeObject, [null]);
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
    const field = fields[fieldIndex];
    const name = field.name;
    const value = formValue(formCall(formDataGet, data, [name], "FormData.get"), "Form field '" + name + "'");
    if (field.kind === "string") {
      if (value == null) output[name] = field.optional ? null : "";
      else if (typeof value === "string") output[name] = value;
      else throw new TypeError("Form field '" + name + "' is not textual");
    } else if (field.kind === "number") {
      if (value == null || (typeof value === "string" && formCall(formStringTrim, value, [], "String.trim") === "")) {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a finite number");
      } else {
        const number = formNumber(value);
        if (number === null) throw new TypeError("Form field '" + name + "' requires a finite decimal number");
        output[name] = number;
      }
    } else if (field.kind === "bool") {
      output[name] = formCall(formDataHas, data, [name], "FormData.has");
    } else if (field.kind === "enum") {
      if (value == null || value === "") {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a known enum value");
      } else if (typeof value === "string") {
        let known = false;
        for (let index = 0; index < field.enumValues.length; index += 1) {
          if (field.enumValues[index] === value) { known = true; break; }
        }
        if (!known) throw new TypeError("Form field '" + name + "' requires a known enum value");
        output[name] = value;
      } else {
        throw new TypeError("Form field '" + name + "' requires a known enum value");
      }
    } else if (field.kind === "strings") {
      const items = formList(formCall(formDataGetAll, data, [name], "FormData.getAll"), "Form field '" + name + "'");
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        formValue(item, "Form field '" + name + "'");
        if (typeof item !== "string") throw new TypeError("Form field '" + name + "' is not textual");
      }
      output[name] = items;
    } else {
      throw new TypeError("Form field '" + name + "' uses an unsupported decoder");
    }
  }
  return type.parse(output);
}

export function fieldValue(form, name) {
  return firstValue(form, name);
}

export function textValue(form, name, fallback = "") {
  name = formText(name, "Form field name");
  fallback = formText(fallback, "Form text fallback", maxFormTextCodeUnits);
  const value = firstValue(form, name);
  if (value == null) return fallback;
  if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
  return value;
}

export function numberValue(form, name) {
  return formNumber(textValue(form, name));
}

export function checkedValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const data = formData(form);
  return formCall(formDataHas, data, [name], "FormData.has");
}

export function fieldValues(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const data = formData(form);
  const values = formList(formCall(formDataGetAll, data, [name], "FormData.getAll"), "Form field '" + name + "'");
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    formValue(value, "Form field '" + name + "'");
    if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
  }
  return values;
}

export function setError(form, name, message) {
  requireForm(form);
  name = formText(name, "Form field name");
  message = formText(message, "Form error message", 65536);
  const field = namedField(form, name);
  if (!field) throw new Error("Form field '" + name + "' was not found");
  const errorNodes = formErrorNodes(form);
  let error = null;
  for (let index = 0; index < errorNodes.length; index += 1) {
    if (formGetAttribute(errorNodes[index], "data-velar-field-error") === name) { error = errorNodes[index]; break; }
  }
  if (!error) {
    error = formHostMethod(formDocumentCreateElement, NativeFormDocumentConstructor, NativeFormDocument, ["p"], "createElement");
    formHostWrite(formElementId, formElementOwner, error, "id", "velar-field-error-" + nextErrorId++);
    formSetAttribute(error, "data-velar-field-error", name);
    formSetAttribute(error, "role", "alert");
    formHostMethod(formElementInsertAdjacentElement, formElementOwner, field, ["afterend", error], "insertAdjacentElement");
  }
  formHostWrite(formNodeTextContent, NativeFormNode, error, "textContent", message);
  formSetAttribute(field, "aria-invalid", "true");
  const described = formAttributeTokens(formGetAttribute(field, "aria-describedby") ?? "");
  const errorId = formText(formHostRead(formElementId, formElementOwner, error, "id"), "Form error id");
  let hasErrorId = false;
  for (let index = 0; index < described.length; index += 1) if (described[index] === errorId) { hasErrorId = true; break; }
  if (!hasErrorId) formListSet(described, described.length, errorId);
  formSetAttribute(field, "aria-describedby", formJoinTokens(described));
  return null;
}

export function clearError(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const field = namedField(form, name);
  const errorNodes = formErrorNodes(form);
  const removedIds = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!removedIds) throw new TypeError("The browser Map API is unavailable");
  for (let index = 0; index < errorNodes.length; index += 1) {
    const error = errorNodes[index];
    if (formGetAttribute(error, "data-velar-field-error") !== name) continue;
    const errorId = formHostRead(formElementId, formElementOwner, error, "id");
    if (typeof errorId === "string" && errorId) formCall(formMapSet, removedIds, [errorId, true], "Map.set");
    formHostMethod(formElementRemove, formElementOwner, error, [], "remove");
  }
  if (field) {
    formRemoveAttribute(field, "aria-invalid");
    const described = formAttributeTokens(formGetAttribute(field, "aria-describedby") ?? "");
    const retained = new __velarListNativeArray();
    for (let index = 0; index < described.length; index += 1) {
      const id = described[index];
      if (!formCall(formMapHas, removedIds, [id], "Map.has")) formListSet(retained, retained.length, id);
    }
    if (retained.length) formSetAttribute(field, "aria-describedby", formJoinTokens(retained));
    else formRemoveAttribute(field, "aria-describedby");
  }
  return null;
}

export function clearErrors(form) {
  requireForm(form);
  const nodes = formErrorNodes(form);
  const seen = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!seen) throw new TypeError("The browser Map API is unavailable");
  const names = new __velarListNativeArray();
  for (let index = 0; index < nodes.length; index += 1) {
    const name = formText(formGetAttribute(nodes[index], "data-velar-field-error") ?? "", "Form error field name");
    if (!name || formCall(formMapHas, seen, [name], "Map.has")) continue;
    formCall(formMapSet, seen, [name, true], "Map.set");
    formListSet(names, names.length, name);
  }
  for (let index = 0; index < names.length; index += 1) clearError(form, names[index]);
  return null;
}

export function errors(form) {
  requireForm(form);
  const nodes = formErrorNodes(form);
  const output = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!output) throw new TypeError("The browser Map API is unavailable");
  for (let index = 0; index < nodes.length; index += 1) {
    const item = nodes[index];
    const name = formText(formGetAttribute(item, "data-velar-field-error") ?? "", "Form error field name");
    const message = formText(formHostRead(formNodeTextContent, NativeFormNode, item, "textContent") ?? "", "Form error message", 65536);
    if (name) formCall(formMapSet, output, [name, message], "Map.set");
  }
  return output;
}

export function focusFirstError(form) {
  requireForm(form);
  const error = formHostMethod(formElementQuerySelector, formElementOwner, form, ["[data-velar-field-error]"], "querySelector");
  const field = error ? namedField(form, formText(formGetAttribute(error, "data-velar-field-error") ?? "", "Form error field name")) : null;
  if (!field) return false;
  formHostMethod(formHtmlFocus, formHtmlOwner, field, [], "focus");
  return true;
}

export function setPending(form, pending) {
  requireForm(form);
  if (typeof pending !== "boolean") throw new TypeError("setPending requires a boolean");
  if (!pendingFields) throw new TypeError("The browser WeakMap API is unavailable");
  if (pending) {
    const elements = formElements(form);
    const snapshot = new __velarListNativeArray();
    for (let index = 0; index < elements.length; index += 1) {
      const field = elements[index];
      if (!field || typeof field !== "object") throw new TypeError("Form controls must expose a bool disabled state");
      const disabled = formControlRead(field, "disabled");
      if (typeof disabled !== "boolean") throw new TypeError("Form controls must expose a bool disabled state");
      const pair = new __velarListNativeArray(2);
      formListSet(pair, 0, field);
      formListSet(pair, 1, disabled);
      formListSet(snapshot, snapshot.length, pair);
    }
    if (!formCall(formWeakMapHas, pendingFields, [form], "WeakMap.has")) formCall(formWeakMapSet, pendingFields, [form, snapshot], "WeakMap.set");
    formSetAttribute(form, "aria-busy", "true");
    for (let index = 0; index < snapshot.length; index += 1) formControlWrite(snapshot[index][0], "disabled", true);
  } else {
    formRemoveAttribute(form, "aria-busy");
    const snapshot = formCall(formWeakMapGet, pendingFields, [form], "WeakMap.get") ?? new __velarListNativeArray();
    for (let index = 0; index < snapshot.length; index += 1) formControlWrite(snapshot[index][0], "disabled", snapshot[index][1]);
    formCall(formWeakMapDelete, pendingFields, [form], "WeakMap.delete");
  }
  return null;
}

export function reset(form) {
  requireForm(form);
  if (!pendingFields) throw new TypeError("The browser WeakMap API is unavailable");
  if (formCall(formWeakMapHas, pendingFields, [form], "WeakMap.has")) setPending(form, false);
  clearErrors(form);
  formHostMethod(formNativeReset, NativeFormElement, form, [], "reset");
  return null;
}

function namedField(form, name) {
  const elements = formElements(form);
  for (let index = 0; index < elements.length; index += 1) if (formControlRead(elements[index], "name") === name) return elements[index];
  return null;
}

function firstValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const data = formData(form);
  return formValue(formCall(formDataGet, data, [name], "FormData.get"), "Form field '" + name + "'");
}

function requireForm(value) {
  let accepted = false;
  if (typeof NativeFormElement === "function" && typeof formHasInstance === "function" && typeof formReflectApply === "function") {
    try { accepted = formReflectApply(formHasInstance, NativeFormElement, [value]); } catch {}
  }
  if (!accepted) throw new TypeError("VelarScript form helpers require a form element");
}
