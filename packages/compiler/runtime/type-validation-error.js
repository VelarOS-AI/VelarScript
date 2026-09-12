// One path implementation serves generated structural checks and velar/validation.
const __velarValidationErrorDefineProperty = globalThis.Object.defineProperty;
const __velarValidationPathIsSafeInteger = globalThis.Number.isSafeInteger;
const __velarValidationMessageSlice = globalThis.String.prototype.slice;
const __velarValidationPathKind = __velarRegisterRuntimeType(__velarValidationFreeze({
  field: "field", listIndex: "listIndex", mapKey: "mapKey", mapValue: "mapValue",
  setElement: "setElement", recordEntry: "recordEntry", truncated: "truncated",
  is(value) { return value === "field" || value === "listIndex" || value === "mapKey" || value === "mapValue" || value === "setElement" || value === "recordEntry" || value === "truncated"; },
  parse(value) { if (!__velarValidationPathKind.is(value)) throw new __VelarValidationError("Value does not match ValidationPathKind"); return value; },
  copy(value) { return value; },
  values() { return ["field", "listIndex", "mapKey", "mapValue", "setElement", "recordEntry", "truncated"]; },
}));
function __velarValidationPath(value = []) {
  if (!__velarValidationIsArray(value)) throw new __velarCollectionNativeTypeError("validation path must be a List");
  const length = __velarValidationOwnDescriptor(value, "length").value;
  if (length > 64) throw new __velarCollectionNativeTypeError("validation path cannot exceed 64 segments");
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const segment = __velarValidationOwnDescriptor(value, index)?.value;
    if (segment === null || typeof segment !== "object") throw new __velarCollectionNativeTypeError("validation path segment must be a record");
    const kind = __velarValidationOwnDescriptor(segment, "kind")?.value;
    let copy;
    if (kind === "field") {
      const name = __velarValidationOwnDescriptor(segment, "name")?.value;
      if (typeof name !== "string") throw new __velarCollectionNativeTypeError("validation field path requires a name");
      copy = {kind, name};
    } else if (kind === "truncated" && index === length - 1) {
      copy = {kind};
    } else if (kind === "listIndex" || kind === "mapKey" || kind === "mapValue" || kind === "setElement" || kind === "recordEntry") {
      const position = __velarValidationOwnDescriptor(segment, "index")?.value;
      if (!__velarCollectionHostCall(__velarValidationPathIsSafeInteger, undefined, [position]) || position < 0) throw new __velarCollectionNativeTypeError("validation path index must be a non-negative safe integer");
      copy = {kind, index: position};
    } else throw new __velarCollectionNativeTypeError("invalid validation path kind or truncated position");
    result[result.length] = copy;
  }
  // readonly is a static view; List uses ordinary mutable array descriptors.
  return result;
}
function __velarValidationPathAppend(path, segment) {
  const result = [];
  const length = path.length < 64 ? path.length : 63;
  for (let index = 0; index < length; index += 1) result[index] = path[index];
  if (path.length > 0 && path[path.length - 1].kind === "truncated") return path;
  result[result.length] = path.length >= 64 ? {kind: "truncated"} : segment;
  return result;
}
function __velarValidationBoundMessage(message) {
  return message.length <= 4096 ? message : __velarCollectionHostCall(__velarValidationMessageSlice, message, [0, 4068]) + " [diagnostic truncated]";
}
function __velarValidationFormatPath(path) {
  let text = "value";
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    text += segment.kind === "field" ? "." + segment.name
      : segment.kind === "truncated" ? " [diagnostic truncated]"
        : "[" + segment.kind + ":" + segment.index + "]";
    if (text.length > 4096) return __velarValidationBoundMessage(text);
  }
  return text;
}
class __VelarValidationError extends __velarCollectionNativeTypeError {
  constructor(message = "", detail) {
    let path = __velarValidationPath(detail?.path ?? []);
    if (detail && __velarValidationFormatPath(path).length + message.length + 2 > 4096) path = __velarValidationPath(__velarValidationPathAppend(path, {kind: "truncated"}));
    const rawReason = detail?.reason ?? null;
    const reason = rawReason !== null && path[path.length - 1]?.kind === "truncated" ? rawReason + " [diagnostic truncated]" : rawReason;
    super(__velarValidationBoundMessage(detail ? __velarValidationFormatPath(path) + ": " + message : message));
    this.name = "ValidationError";
    __velarValidationErrorDefineProperty(this, "path", {value: path, enumerable: true});
    this.reason = reason === null ? null : __velarValidationBoundMessage(reason);
  }
  get field() {
    const tail = this.path[this.path.length - 1];
    return tail?.kind === "field" ? tail.name : null;
  }
}
__velarValidationErrorDefineProperty(__VelarValidationError, "name", { value: "ValidationError", writable: false, enumerable: false, configurable: true });

function __velarValidationExplain(type, value) {
  const state = {nodes: 0, active: new __velarValidationNativeWeakMap()};
  return __velarValidationLocate({kind: "reference", target: () => type}, value, [], state)
    ?? {path: [], reason: "the value does not match the expected type"};
}
function __velarValidationDiagnosticFailure(path, reason) {
  return {path, reason: path[path.length - 1]?.kind === "truncated" ? reason + " [diagnostic truncated]" : reason};
}
function __velarValidationDiagnosticTruncated(path) {
  return {path: __velarValidationPathAppend(path, {kind: "truncated"}), reason: "diagnostic truncated"};
}
function __velarValidationLocate(plan, value, path, state) {
  if (++state.nodes > 4096 || path.length > 64 || path[path.length - 1]?.kind === "truncated") return __velarValidationDiagnosticTruncated(path);
  const fail = () => __velarValidationDiagnosticFailure(path, "the value does not match " + (plan.name ?? "the expected type"));
  const child = (nested, item, segment) => __velarValidationLocate(nested, item, __velarValidationPathAppend(path, segment), state);
  if (plan.kind === "reference" || plan.kind === "lazy") {
    const type = plan.kind === "lazy" ? plan.target : plan.target();
    if (plan.kind === "reference" && typeof type.diagnosticPlan !== "function") return type.is(value) ? null : fail();
    let active;
    if (value !== null && typeof value === "object") {
      active = __velarValidationWeakMapGet(state.active, value);
      if (active && __velarValidationSetHas(active, type)) return __velarValidationDiagnosticFailure(path, "cyclic value does not match the expected type");
      if (!active) { active = __velarValidationSet(); __velarValidationWeakMapSet(state.active, value, active); }
      __velarValidationSetAdd(active, type);
    }
    try { return __velarValidationLocate(plan.kind === "lazy" ? type() : type.diagnosticPlan(), value, path, state); }
    finally { if (active) __velarValidationSetDelete(active, type); }
  }
  if (plan.kind === "optional") return value == null ? null : __velarValidationLocate(plan.inner, value, path, state);
  if (plan.kind === "leaf") return plan.check(value) ? null : fail();
  if (plan.kind === "union") {
    // Validate all alternatives within the same budget; only a uniquely proven
    // enum discriminant permits reporting inside a failed branch.
    const failures = [];
    const tags = [];
    for (let index = 0; index < plan.members.length; index += 1) {
      const member = plan.members[index];
      const failure = __velarValidationLocate(member, value, path, state);
      if (failure === null) return null;
      if (state.nodes > 4096) return __velarValidationDiagnosticTruncated(path);
      failures[index] = failure;
      tags[index] = __velarValidationDiscriminants(member, value, state);
      if (state.nodes > 4096) return __velarValidationDiagnosticTruncated(path);
    }
    let selected = -1;
    for (let tagIndex = 0; tagIndex < (tags[0]?.length ?? 0); tagIndex += 1) {
      const name = tags[0][tagIndex].name;
      let candidate = -1;
      let common = true;
      let matches = 0;
      for (let index = 0; index < tags.length; index += 1) {
        let found = false;
        for (let position = 0; position < tags[index].length; position += 1) {
          if (++state.nodes > 4096) return __velarValidationDiagnosticTruncated(path);
          const tag = tags[index][position];
          if (tag.name !== name) continue;
          found = true;
          if (tag.matches) { candidate = index; matches += 1; }
          break;
        }
        if (!found) common = false;
      }
      if (common && matches === 1) {
        if (selected >= 0 && selected !== candidate) return fail();
        selected = candidate;
      }
    }
    return selected >= 0 ? failures[selected] : fail();
  }

  if (plan.kind === "object") {
    if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || !__velarValidationIsPlainObject(value)) return __velarValidationDiagnosticFailure(path, "the value is not a record");
    if (plan.base) { const error = __velarValidationLocate(plan.base, value, path, state); if (error) return error; }
    for (let index = 0; index < plan.fields.length; index += 1) {
      if (++state.nodes > 4096) return __velarValidationDiagnosticTruncated(path);
      const field = plan.fields[index];
      const descriptor = __velarValidationOwnDescriptor(value, field.name);
      const segment = {kind: "field", name: field.name};
      if (descriptor === undefined && field.optional) continue;
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return __velarValidationDiagnosticFailure(__velarValidationPathAppend(path, segment), "field '" + field.name + "' " + (descriptor === undefined ? "is missing" : "must be an enumerable data property"));
      const error = child(field.plan, descriptor.value, segment);
      if (error) return error;
    }
    return null;
  }
  if (plan.kind === "list") {
    if (!__velarValidationIsArray(value)) return fail();
    const lengthDescriptor = __velarValidationOwnDescriptor(value, "length");
    const length = lengthDescriptor.value;
    if (length > 1000000 || !lengthDescriptor.writable || __velarCollectionHostCall(__velarCollectionOwnSymbols, __velarCollectionNativeObject, [value]).length > 0 || __velarCollectionHostCall(__velarCollectionOwnNames, __velarCollectionNativeObject, [value]).length !== length + 1) return fail();
    for (let index = 0; index < length; index += 1) {
      const descriptor = __velarValidationOwnDescriptor(value, index);
      if (!descriptor?.enumerable || !descriptor.writable || !descriptor.configurable || !("value" in descriptor)) return __velarValidationDiagnosticFailure(__velarValidationPathAppend(path, {kind: "listIndex", index}), "element must be a data property");
      const error = child(plan.element, descriptor.value, {kind: "listIndex", index});
      if (error) return error;
    }
    return null;
  }
  if (plan.kind === "map" || plan.kind === "set") {
    const map = plan.kind === "map";
    if (map ? !__velarIsMap(value) : !__velarIsSet(value)) return fail();
    if (__velarCollectionHostCall(map ? __velarCollectionMapSize : __velarCollectionSetSize, value, []) > 1000000) return fail();
    const iterator = map ? __velarCollectionMapTypeIterator(value) : __velarCollectionSetTypeIterator(value);
    for (let index = 0; ; index += 1) {
      const step = map ? __velarCollectionMapTypeNext(iterator) : __velarCollectionSetTypeNext(iterator);
      if (step.done) return null;
      if (map) {
        const error = child(plan.key, step.value[0], {kind: "mapKey", index});
        if (error) return error;
      }
      const error = child(plan.element, map ? step.value[1] : step.value, {kind: map ? "mapValue" : "setElement", index});
      if (error) return error;
    }
  }
  if (plan.kind === "record") {
    if (!__velarIsRecord(value)) return fail();
    const keys = __velarCollectionHostCall(__velarCollectionOwnKeys, __velarCollectionNativeReflect, [value]);
    if (keys.length > 1000000) return fail();
    let position = 0;
    for (let index = 0; index < keys.length; index += 1) {
      if (++state.nodes > 4096) return __velarValidationDiagnosticTruncated(path);
      const descriptor = __velarValidationOwnDescriptor(value, keys[index]);
      const segment = {kind: "recordEntry", index: position++};
      if (typeof keys[index] !== "string" || !descriptor?.enumerable || !descriptor.writable || !descriptor.configurable || !("value" in descriptor)) return __velarValidationDiagnosticFailure(__velarValidationPathAppend(path, segment), "entry must be a text-keyed data property");
      const error = child(plan.element, descriptor.value, segment);
      if (error) return error;
    }
    return null;
  }
  return fail();
}
function __velarValidationDiscriminants(plan, value, state) {
  if (++state.nodes > 4096 || value === null || typeof value !== "object") return [];
  if (plan.kind === "lazy") return __velarValidationDiscriminants(plan.target(), value, state);
  if (plan.kind === "reference") {
    const type = plan.target();
    return typeof type.diagnosticPlan === "function" ? __velarValidationDiscriminants(type.diagnosticPlan(), value, state) : [];
  }
  if (plan.kind !== "object") return [];
  const result = plan.base ? __velarValidationDiscriminants(plan.base, value, state) : [];
  for (let index = 0; index < plan.fields.length; index += 1) {
    if (++state.nodes > 4096) return result;
    const field = plan.fields[index];
    let fieldPlan = field.plan;
    while (fieldPlan.kind === "lazy") {
      if (++state.nodes > 4096) return result;
      fieldPlan = fieldPlan.target();
    }
    if (!fieldPlan.discriminant) continue;
    const descriptor = __velarValidationOwnDescriptor(value, field.name);
    result[result.length] = {name: field.name, matches: !!descriptor?.enumerable && "value" in descriptor && fieldPlan.check(descriptor.value)};
  }
  return result;
}
