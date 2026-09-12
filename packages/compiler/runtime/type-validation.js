const __velarValidationNativeWeakMap = globalThis.WeakMap;
const __velarValidationNativeSet = globalThis.Set;
const __velarValidationNativePromise = globalThis.Promise;
const __velarValidationNativeFunction = globalThis.Function;
const __velarValidationNativeSymbol = globalThis.Symbol;
const __velarValidationWeakMapPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeWeakMap, "prototype")?.value;
const __velarValidationSetPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeSet, "prototype")?.value;
const __velarValidationFunctionPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeFunction, "prototype")?.value;
const __velarValidationHasInstanceSymbol = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeSymbol, "hasInstance")?.value;
const __velarValidationWeakMapGetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationWeakMapPrototype, "get")?.value;
const __velarValidationWeakMapSetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationWeakMapPrototype, "set")?.value;
const __velarValidationWeakMapDeleteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationWeakMapPrototype, "delete")?.value;
const __velarValidationSetHasOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "has")?.value;
const __velarValidationSetAddOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "add")?.value;
const __velarValidationSetDeleteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "delete")?.value;
const __velarValidationSetSizeOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "size")?.get;
const __velarValidationFunctionHasInstanceOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationFunctionPrototype, __velarValidationHasInstanceSymbol)?.value;
const __velarValidationFreezeOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "freeze")?.value;
const __velarValidationDefinePropertyOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "defineProperty")?.value;
const __velarValidationMapSetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "set")?.value;
const __velarValidationMapGetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "get")?.value;
// D90 rule R5: the per-call graph state carries both the validator's cycle
// guard and the copy memo, because parse runs one then the other over the same
// object graph. 'copies' stays null until something is actually copied.
function __velarValidationState() { return { active: new __velarValidationNativeWeakMap(), depth: 0, copies: null, copy: __velarValidationCopy }; }
function __velarValidationSet() { return new __velarValidationNativeSet(); }
function __velarValidationWeakMapGet(value, key) { return __velarCollectionHostCall(__velarValidationWeakMapGetOperation, value, [key]); }
function __velarValidationWeakMapSet(value, key, item) { return __velarCollectionHostCall(__velarValidationWeakMapSetOperation, value, [key, item]); }
function __velarValidationWeakMapDelete(value, key) { return __velarCollectionHostCall(__velarValidationWeakMapDeleteOperation, value, [key]); }
function __velarValidationMapGet(value, key) { return __velarCollectionHostCall(__velarValidationMapGetOperation, value, [key]); }
function __velarValidationMapSet(value, key, item) { return __velarCollectionHostCall(__velarValidationMapSetOperation, value, [key, item]); }
function __velarValidationSetHas(value, item) { return __velarCollectionHostCall(__velarValidationSetHasOperation, value, [item]); }
function __velarValidationSetAdd(value, item) { return __velarCollectionHostCall(__velarValidationSetAddOperation, value, [item]); }
function __velarValidationSetDelete(value, item) { return __velarCollectionHostCall(__velarValidationSetDeleteOperation, value, [item]); }
function __velarValidationSetSize(value) { return __velarCollectionHostCall(__velarValidationSetSizeOperation, value, []); }
function __velarValidationIsArray(value) { return __velarCollectionHostCall(__velarCollectionArrayIsArray, __velarCollectionNativeArray, [value]); }
function __velarValidationOwnDescriptor(value, key) { return __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]); }
function __velarValidationIsInstance(value, constructor) { return __velarCollectionHostCall(__velarValidationFunctionHasInstanceOperation, constructor, [value]); }
function __velarValidationIsPromise(value) { return __velarValidationIsInstance(value, __velarValidationNativePromise); }
function __velarValidationFreeze(value) { return __velarCollectionHostCall(__velarValidationFreezeOperation, __velarCollectionNativeObject, [value]); }
// A record contract accepts only plain data objects: prototype null, or a
// prototype that itself has none (some realm's Object.prototype). The check
// is structural rather than an identity comparison so plain values from other
// realms validate, while class instances, Error values, and host objects are
// rejected — their prototypes always chain through another object.
function __velarValidationIsPlainObject(value) {
  const prototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [value]);
  if (prototype === null) return true;
  return __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [prototype]) === null;
}
// D90 rule R5: parse returns a copy, so "validated" means "and it stays
// valid" rather than "it was correct at the instant of the check". The copy
// follows the declared shape — the generated validators supply one callback
// per element position — and the memo answers per source object *and* copy
// plan, so a shared or cyclic subgraph is copied once per declared shape and
// the copy preserves the sharing the source had. Keying on the source alone
// would hand the second projection of one object the first projection's copy:
// a value the caller never wrote and no declared type ever accepted. The four
// container members are spelled with an "Of" suffix because this runtime
// reaches every host collection through a captured operation: no member call
// inside it may read as a get, set, has, add, or delete call, which is the
// boundary gate's rule for this file.
const __velarValidationCopy = {
  seen(state, value, plan) {
    if (state.copies === null) return undefined;
    const plans = __velarValidationWeakMapGet(state.copies, value);
    return plans === undefined ? undefined : __velarValidationMapGet(plans, plan);
  },
  remember(state, value, copy, plan) {
    if (state.copies === null) state.copies = new __velarValidationNativeWeakMap();
    let plans = __velarValidationWeakMapGet(state.copies, value);
    if (plans === undefined) {
      plans = new __velarCollectionNativeMap();
      __velarValidationWeakMapSet(state.copies, value, plans);
    }
    __velarValidationMapSet(plans, plan, copy);
    return copy;
  },
  object(state, value, plan) {
    return __velarValidationCopy.remember(state, value, {}, plan);
  },
  // Fields are written through defineProperty so a field literally named
  // '__proto__' lands as an own data property instead of retargeting the
  // copy's prototype, and so every copied field is an ordinary mutable
  // enumerable data property whatever the source's descriptor said.
  field(target, name, value) {
    __velarCollectionHostCall(__velarValidationDefinePropertyOperation, __velarCollectionNativeObject, [target, name, { value: value, writable: true, enumerable: true, configurable: true }]);
  },
  // A null element callback means the element position has nothing to copy —
  // a primitive, an enum member, a class instance, or an opaque 'unknown'.
  // 'plan' is the container position's own stable identity: the emitter hoists
  // one function per distinct copy plan and hands it in as both the element
  // callback and the key this memo files the copy under.
  listOf(value, state, item, plan) {
    const found = __velarValidationCopy.seen(state, value, plan);
    if (found !== undefined) return found;
    const result = __velarValidationCopy.remember(state, value, [], plan);
    const length = __velarValidationOwnDescriptor(value, "length")?.value ?? 0;
    for (let index = 0; index < length; index += 1) {
      const descriptor = __velarValidationOwnDescriptor(value, index);
      result[index] = item === null ? descriptor?.value : item(descriptor?.value, state);
    }
    return result;
  },
  setOf(value, state, item, plan) {
    const found = __velarValidationCopy.seen(state, value, plan);
    if (found !== undefined) return found;
    const result = __velarValidationCopy.remember(state, value, __velarValidationSet(), plan);
    const iterator = __velarCollectionSetTypeIterator(value);
    while (true) {
      const step = __velarCollectionSetTypeNext(iterator);
      if (step.done) break;
      __velarValidationSetAdd(result, item === null ? step.value : item(step.value, state));
    }
    return result;
  },
  mapOf(value, state, key, item, plan) {
    const found = __velarValidationCopy.seen(state, value, plan);
    if (found !== undefined) return found;
    const result = __velarValidationCopy.remember(state, value, new __velarCollectionNativeMap(), plan);
    const iterator = __velarCollectionMapTypeIterator(value);
    while (true) {
      const step = __velarCollectionMapTypeNext(iterator);
      if (step.done) break;
      const entry = step.value;
      __velarValidationMapSet(result, key === null ? entry[0] : key(entry[0], state), item === null ? entry[1] : item(entry[1], state));
    }
    return result;
  },
  recordOf(value, state, item, plan) {
    const found = __velarValidationCopy.seen(state, value, plan);
    if (found !== undefined) return found;
    const result = __velarValidationCopy.remember(state, value, {}, plan);
    const keys = __velarCollectionHostCall(__velarCollectionOwnKeys, __velarCollectionNativeReflect, [value]);
    for (let index = 0; index < keys.length; index += 1) {
      const name = keys[index];
      if (typeof name !== "string") continue;
      const descriptor = __velarValidationOwnDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) continue;
      __velarValidationCopy.field(result, name, item === null ? descriptor.value : item(descriptor.value, state));
    }
    return result;
  },
  // A generic instantiation supplies a predicate per type argument but no copy
  // plan, and a structural or union position is validated as a shape the
  // predicate did not fully decide. Both copy the plain data they can see:
  // arrays, Maps, Sets, and plain objects recurse; anything else — a class
  // instance, a promise, a function, a binary buffer — is not plain data and
  // passes through by reference.
  plain(value, state) {
    if (value === null || typeof value !== "object") return value;
    const found = __velarValidationCopy.seen(state, value, __velarValidationCopy.plain);
    if (found !== undefined) return found;
    if (__velarValidationIsArray(value)) return __velarValidationCopy.listOf(value, state, __velarValidationCopy.plain, __velarValidationCopy.plain);
    if (__velarIsMap(value)) return __velarValidationCopy.mapOf(value, state, __velarValidationCopy.plain, __velarValidationCopy.plain, __velarValidationCopy.plain);
    if (__velarIsSet(value)) return __velarValidationCopy.setOf(value, state, __velarValidationCopy.plain, __velarValidationCopy.plain);
    if (!__velarValidationIsPlainObject(value)) return value;
    return __velarValidationCopy.recordOf(value, state, __velarValidationCopy.plain, __velarValidationCopy.plain);
  },
  // A Type object from a target extension, or one emitted by an older build,
  // may carry no copy plan; the structural copy is what is left to fall back on.
  // A Type that does answer 'copy' owns its own plan identity — a declared
  // record files under its copy function, an instantiation under its arguments
  // — so nothing is threaded in from here.
  through(type, value, state) {
    const operation = type === null || type === undefined ? undefined : type.copy;
    if (typeof operation !== "function") return __velarValidationCopy.plain(value, state);
    return __velarCollectionHostCall(operation, type, [value, state]);
  },
};
// Teaching suffix for record parse failures caused by the plain-object rule.
function __velarValidationRejectionHint(value) {
  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || __velarValidationIsPlainObject(value)) return "";
  return "; a record accepts only plain data objects — project the fields into a record first, for example {x: instance.x}";
}

// Anonymous records share the descriptor and graph-state rules of declared
// records. The check function and its generic argument object together identify
// a plan; two instantiations must never borrow one another's active proof.
const __velarValidationObjectPlans = new __velarValidationNativeWeakMap();
function __velarValidationObjectPlan(check, arguments_) {
  if (arguments_ === undefined) return check;
  let plans = __velarValidationWeakMapGet(__velarValidationObjectPlans, check);
  if (plans === undefined) {
    plans = new __velarValidationNativeWeakMap();
    __velarValidationWeakMapSet(__velarValidationObjectPlans, check, plans);
  }
  let plan = __velarValidationWeakMapGet(plans, arguments_);
  if (plan === undefined) {
    plan = {};
    __velarValidationWeakMapSet(plans, arguments_, plan);
  }
  return plan;
}
function __velarObjectTypeIs(value, check, state, arguments_, guarded = true) {
  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || !__velarValidationIsPlainObject(value)) return false;
  if (!guarded) return check(value, state, arguments_);
  state ??= __velarValidationState();
  if (state.depth >= 1000) return false;
  const plan = __velarValidationObjectPlan(check, arguments_);
  let active = __velarValidationWeakMapGet(state.active, value);
  if (active && __velarValidationSetHas(active, plan)) return false;
  if (!active) {
    active = __velarValidationSet();
    __velarValidationWeakMapSet(state.active, value, active);
  }
  __velarValidationSetAdd(active, plan);
  state.depth += 1;
  try { return check(value, state, arguments_); }
  finally {
    state.depth -= 1;
    __velarValidationSetDelete(active, plan);
    if (__velarValidationSetSize(active) === 0) __velarValidationWeakMapDelete(state.active, value);
  }
}
