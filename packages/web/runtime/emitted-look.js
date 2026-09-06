function __velarClass(element, name, read, scope) {
  __velarClassBind(element, () => read() ? name : null, scope);
}

// The property a token carries. A token is '[target:]conditions:property' and
// a CSS property name never contains ':', so the last segment is the property.
function __velarLookProperty(token) {
  return token.slice(token.lastIndexOf(":") + 1);
}

// The surface a token writes on: its pseudo-element target, if it has one, plus
// its property. Composition overrides a property on the surface that owns it —
// '@before: content' and a bare 'content' are two surfaces, not one property
// written under two conditions.
function __velarLookSurface(token) {
  const first = token.indexOf(":");
  const last = token.lastIndexOf(":");
  return (first === last ? "" : token.slice(0, first + 1)) + token.slice(last + 1);
}

// Whether a token declares its property unconditionally: an unconditional
// declaration spells its condition segment 'base', so the segment in front of
// the property is what says a token stands on its own.
function __velarLookUnconditional(token) {
  const last = token.lastIndexOf(":");
  return token.slice(token.lastIndexOf(":", last - 1) + 1, last) === "base";
}

// Composition is property-level across sources and token-level inside one look
// block. A later unconditional declaration wins its property outright, so it
// drops every condition the earlier sources wrote it under: the caller of a
// component could otherwise not reach a padding the component set behind its
// own private breakpoint, and 'the caller wins every property both of them set'
// was true only under the identical condition (LOK-U10). A later conditional
// declaration refines rather than replaces — it overwrites the identical token
// and leaves the earlier unconditional value standing, because a caller that
// writes only 'if @hover: color' never mentioned the resting colour and must
// not delete it. Declarations written in one block are one source, so a block's
// own 'if scheme.dark:' and 'if @hover:' still coexist and the cascade decides
// between them.
function __velarMergeRules(rules, groups, source, group) {
  const names = __velarGraphOwnNames(source);
  const owned = __velarGraphOwnNames(rules);
  for (let index = 0; index < names.length; index += 1) {
    const descriptor = __velarGraphOwnDescriptor(source, names[index]);
    if (!descriptor || !("value" in descriptor)) continue;
    if (!__velarLookUnconditional(names[index])) continue;
    const surface = __velarLookSurface(names[index]);
    for (let other = 0; other < owned.length; other += 1) {
      const token = owned[other];
      if (groups[token] === group || __velarLookSurface(token) !== surface) continue;
      delete rules[token];
      delete groups[token];
    }
  }
  for (let index = 0; index < names.length; index += 1) {
    const descriptor = __velarGraphOwnDescriptor(source, names[index]);
    if (!descriptor || !("value" in descriptor)) continue;
    if (descriptor.value == null) { delete rules[names[index]]; delete groups[names[index]]; continue; }
    rules[names[index]] = descriptor.value;
    groups[names[index]] = group;
  }
}

function __velarLook(parts) {
  const rules = __velarGraphCreateRecord();
  const groups = __velarGraphCreateRecord();
  // A built Look is one source. A bare rules record is a run of declarations
  // written in one look block, so consecutive ones share a source and a spread
  // between them opens the next.
  let group = 0;
  let run = 0;
  const add = (part) => {
    if (part == null || part === false) return;
    if (__velarGraphIsList(part)) { for (let index = 0; index < part.length; index += 1) add(part[index]); return; }
    if (part.__velarLook === true) {
      group += 1;
      run = 0;
      __velarMergeRules(rules, groups, part.rules, group);
      return;
    }
    if (part.rules && typeof part.rules === "object") {
      if (run === 0) { group += 1; run = group; }
      __velarMergeRules(rules, groups, part.rules, run);
      return;
    }
    throw new TypeError("look composition accepts only Look, Look?, or lists of Look values");
  };
  add(parts);
  return __velarGraphFreeze({ __velarLook: true, rules: __velarGraphFreeze(rules) });
}

function __velarKeyframesValue(name) {
  if (typeof name !== "string" || !/^velar-kf-[0-9a-f]{8,32}$/.test(name)) throw new TypeError("Generated keyframes name is invalid");
  return __velarGraphFreeze({ __velarKeyframes: true, name });
}

function __velarLookVariable(token) {
  return "--velar-look-" + token.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function __velarLookValue(token, value) {
  if (token.endsWith(":animation")) return __velarAnimationLookValue(value);
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("Look properties require finite numbers");
    return __velarDomString(value);
  }
  if (typeof value !== "string") throw new TypeError("Look properties require text, finite numbers, typed visual values, or null");
  if (value.length > 1024 * 1024) throw new RangeError("A Look property value cannot exceed 1 MiB");
  if (token.endsWith(":content") && typeof value === "string" && value !== "none" && value !== "normal") return __velarCssString(value);
  // A closed keyword set is the property's whole string vocabulary, so a value
  // the compiler could not read — a prop, a record field, a call result — is
  // checked here instead. Without this a 'display' bound to "grdi" reached the
  // browser as a declaration it silently discards (LOK-U14).
  const keywords = __velarLookKeywords[__velarLookProperty(token)];
  if (keywords !== undefined && !__velarHasName(keywords, value.trim())) {
    let expected = "";
    for (let index = 0; index < keywords.length; index += 1) expected += (expected === "" ? "" : ", ") + keywords[index];
    throw new TypeError("Look property '" + __velarLookProperty(token) + "' does not accept '" + value + "'; use one of " + expected);
  }
  return value;
}

function __velarAnimationLookValue(value) {
  const parts = [];
  const add = (item) => {
    if (__velarGraphIsList(item)) {
      for (let index = 0; index < item.length; index += 1) add(item[index]);
      return;
    }
    const marker = item && (typeof item === "object" || typeof item === "function")
      ? __velarGraphOwnDescriptor(item, "__velarAnimation") : null;
    const css = item && (typeof item === "object" || typeof item === "function")
      ? __velarGraphOwnDescriptor(item, "css") : null;
    if (!marker || !("value" in marker) || marker.value !== true || !css || !("value" in css) || typeof css.value !== "string") {
      throw new TypeError("Look animation requires Animation or a List of Animation values from animate()");
    }
    __velarAppendOwned(parts, css.value);
  };
  add(value);
  if (parts.length === 0) throw new TypeError("A Look animation list cannot be empty");
  let output = parts[0];
  for (let index = 1; index < parts.length; index += 1) output += ", " + parts[index];
  return output;
}

const __velarInlineStyleProperties = __velarGraphCreateSet(["display","position","box-sizing","isolation","contain","visibility","z-index","overflow","overflow-x","overflow-y","resize","clip","clip-path","object-fit","object-position","aspect-ratio","grid-template-columns","grid-template-rows","grid-template-areas","grid-auto-columns","grid-auto-rows","grid-auto-flow","grid-column","grid-column-start","grid-column-end","grid-row","grid-row-start","grid-row-end","grid-area","flex","flex-direction","flex-grow","flex-shrink","flex-basis","flex-wrap","order","gap","row-gap","column-gap","align-items","justify-items","justify-content","align-content","align-self","justify-self","place-items","place-content","place-self","width","height","min-width","max-width","min-height","max-height","inline-size","block-size","min-inline-size","max-inline-size","min-block-size","max-block-size","inset","top","right","bottom","left","inset-inline","inset-block","inset-inline-start","inset-inline-end","inset-block-start","inset-block-end","padding","padding-top","padding-right","padding-bottom","padding-left","padding-inline","padding-block","padding-inline-start","padding-inline-end","padding-block-start","padding-block-end","margin","margin-top","margin-right","margin-bottom","margin-left","margin-inline","margin-block","margin-inline-start","margin-inline-end","margin-block-start","margin-block-end","background","background-color","background-image","background-position","background-size","background-repeat","background-attachment","background-clip","background-origin","background-blend-mode","border","border-width","border-style","border-color","border-top","border-right","border-bottom","border-left","border-top-width","border-right-width","border-bottom-width","border-left-width","border-top-style","border-right-style","border-bottom-style","border-left-style","border-top-color","border-right-color","border-bottom-color","border-left-color","border-radius","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","outline","outline-width","outline-style","outline-color","outline-offset","box-shadow","text-shadow","opacity","filter","backdrop-filter","content","color","font-family","font-size","font-weight","font-style","font-stretch","font-variant","font-kerning","font-optical-sizing","font-feature-settings","font-variation-settings","line-height","vertical-align","letter-spacing","word-spacing","text-align","text-indent","text-decoration","text-decoration-color","text-decoration-line","text-decoration-style","text-decoration-thickness","text-underline-offset","text-underline-position","text-transform","text-rendering","white-space","text-overflow","text-wrap","overflow-wrap","word-break","hyphens","tab-size","writing-mode","text-orientation","direction","unicode-bidi","list-style","list-style-type","list-style-position","list-style-image","fill","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","translate","scale","rotate","transform","transform-origin","transition","transition-property","transition-duration","transition-delay","transition-timing-function","animation","cursor","pointer-events","user-select","touch-action","appearance","accent-color","caret-color","color-scheme","scroll-behavior","scroll-margin","scroll-margin-top","scroll-margin-right","scroll-margin-bottom","scroll-margin-left","scroll-padding","scroll-padding-top","scroll-padding-right","scroll-padding-bottom","scroll-padding-left","scroll-snap-align","scroll-snap-stop","scroll-snap-type","overscroll-behavior","overscroll-behavior-x","overscroll-behavior-y","scrollbar-color","scrollbar-width"]);

function __velarStyleDeclarations(value) {
  if (!value || typeof value !== "object" || __velarGraphIsList(value)
    || (__velarGraphPrototype(value) !== __velarGraphNativeObject.prototype && __velarGraphPrototype(value) !== null)
    || __velarWebErrorOwnSymbols(value).length > 0) {
    throw new TypeError("style:* requires compiler-owned inline declarations");
  }
  const names = __velarGraphOwnNames(value);
  if (names.length > 225) throw new RangeError("An inline Style has too many properties");
  const output = {};
  for (let index = 0; index < names.length; index += 1) {
    const property = names[index];
    if (!__velarGraphSetContains(__velarInlineStyleProperties, property)) throw new TypeError("Unknown inline Style property '" + property + "'");
    const descriptor = __velarGraphOwnDescriptor(value, property);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Inline Style declarations cannot use accessors");
    __velarGraphDefine(output, property, { value: descriptor.value, enumerable: true, configurable: false, writable: false });
  }
  return __velarGraphFreeze(output);
}

function __velarInlineStyleState(element) {
  const current = __velarGraphOwnDescriptor(element, "__velarInlineStyleState");
  if (current) {
    if (!("value" in current) || current.enumerable || current.configurable || current.writable
      || !current.value || typeof current.value !== "object") throw new TypeError("Inline Style ownership is invalid");
    return current.value;
  }
  const state = __velarGraphFreeze({ base: __velarGraphCreateMap(), managed: __velarGraphCreateSet() });
  __velarGraphDefine(element, "__velarInlineStyleState", { value: state });
  return state;
}

function __velarAttachSource(registry, element, source) {
  let sources = __velarGraphWeakMapRead(registry, element);
  if (!sources) { sources = __velarGraphCreateSet(); __velarGraphWeakMapWrite(registry, element, sources); }
  __velarGraphSetInsert(sources, source);
  return sources;
}

function __velarDetachSource(registry, element, source) {
  const sources = __velarGraphWeakMapRead(registry, element);
  if (!sources) return;
  __velarGraphSetRemove(sources, source);
  if (__velarGraphSetCount(sources) === 0) __velarGraphWeakMapRemove(registry, element);
}

function __velarApplyStyles(element) {
  const sources = __velarGraphWeakMapRead(__velarRuntime.lookSources, element);
  const merged = __velarGraphCreateMap();
  if (sources) {
    for (const source of __velarGraphSetItems(sources)) {
      if (!source.styles) continue;
      const names = __velarGraphOwnNames(source.styles);
      for (let index = 0; index < names.length; index += 1) {
        __velarGraphMapWrite(merged, names[index], __velarGraphOwnDescriptor(source.styles, names[index]).value);
      }
    }
  }
  const state = __velarInlineStyleState(element);
  const next = __velarGraphCreateSet(__velarGraphMapKeyItems(merged));
  for (const property of __velarGraphSetItems(next)) {
    if (__velarGraphSetContains(state.managed, property)) continue;
    __velarGraphMapWrite(state.base, property, {
      value: __velarDomStyleValue(element, property),
      priority: __velarDomStylePriority(element, property),
    });
  }
  for (const property of __velarGraphSetItems(state.managed)) {
    if (__velarGraphSetContains(next, property)) continue;
    const base = __velarGraphMapRead(state.base, property);
    if (!base || (base.value === "" && base.priority === "")) __velarDomStyleClear(element, property);
    else __velarDomStyleWrite(element, property, base.value, base.priority);
    __velarGraphMapRemove(state.base, property);
  }
  for (const property of __velarGraphSetItems(next)) {
    const value = __velarGraphMapRead(merged, property);
    if (value == null) __velarDomStyleClear(element, property);
    else __velarDomStyleWrite(element, property, __velarLookValue("base:" + property, value));
  }
  __velarGraphSetEmpty(state.managed);
  for (const property of __velarGraphSetItems(next)) __velarGraphSetInsert(state.managed, property);
}

function __velarStyleBind(element, read, scope) {
  const source = { rules: __velarGraphCreateRecord(), styles: {} };
  __velarAttachSource(__velarRuntime.lookSources, element, source);
  __velarObserver(() => {
    source.styles = __velarStyleDeclarations(read());
    __velarApplyStyles(element);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarDetachSource(__velarRuntime.lookSources, element, source);
    __velarApplyStyles(element);
  });
}

function __velarMoveStyleSource(source, previous, next) {
  if (previous) {
    __velarDetachSource(__velarRuntime.lookSources, previous, source);
    __velarApplyStyles(previous);
  }
  if (next) {
    __velarAttachSource(__velarRuntime.lookSources, next, source);
    __velarApplyStyles(next);
  }
}

// The dynamic-root marker sits on a fragment the emitter created, but the
// fragment is still a host object: a planted prototype getter would otherwise
// hand look/class/style application a forged host element.
function __velarDynamicRootState(root) {
  if (root === null || root === undefined) return null;
  const descriptor = __velarGraphOwnDescriptor(root, "__velarDynamicRoot");
  return descriptor && "value" in descriptor && descriptor.value && typeof descriptor.value === "object"
    ? descriptor.value
    : null;
}

function __velarStyleBindRoot(root, read, scope) {
  const dynamic = __velarDynamicRootState(root);
  if (!dynamic) {
    __velarStyleBind(__velarRootHost(root, "style"), read, scope);
    return;
  }
  const source = { rules: __velarGraphCreateRecord(), styles: {} };
  let host = null;
  const move = (next) => {
    __velarMoveStyleSource(source, host, next);
    host = next;
  };
  __velarGraphSetInsert(dynamic.listeners, move);
  move(dynamic.host);
  __velarObserver(() => {
    source.styles = __velarStyleDeclarations(read());
    if (host) __velarApplyStyles(host);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarGraphSetRemove(dynamic.listeners, move);
    move(null);
  });
}

// Look and class ownership lives in one non-enumerable, non-configurable data
// property per element, discovered through the captured descriptor ABI exactly
// like inline style ownership. An ambient expando read would let a hostile
// prototype hand the framework a forged token set.
function __velarElementState(element, name, create) {
  const current = __velarGraphOwnDescriptor(element, name);
  if (current) {
    if (!("value" in current) || current.enumerable || current.configurable || current.writable
      || !current.value || typeof current.value !== "object") throw new TypeError("VelarScript element ownership is invalid");
    return current.value;
  }
  const state = create();
  __velarGraphDefine(element, name, { value: state });
  return state;
}

function __velarApplyLooks(element) {
  const sources = __velarGraphWeakMapRead(__velarRuntime.lookSources, element);
  const merged = __velarGraphCreateRecord();
  const groups = __velarGraphCreateRecord();
  if (sources) {
    // Each attached source is one Look, so a source that sets a property
    // unconditionally drops the property's other conditions from the sources
    // before it: the caller of a component composes after the component's own
    // host look and wins every property both of them set, whatever condition
    // either wrote it under. A source that writes the property only under a
    // condition refines that condition alone — the identical token is
    // overwritten and the earlier unconditional value stays, so the caller does
    // not delete a resting value it never mentioned.
    //
    // A null rule keeps its token: the token drives the generated selector and
    // only the custom property behind it disappears.
    let group = 0;
    for (const source of __velarGraphSetItems(sources)) {
      group += 1;
      const names = __velarGraphOwnNames(source.rules);
      const owned = __velarGraphOwnNames(merged);
      for (let index = 0; index < names.length; index += 1) {
        // A rule the assignment pass below refuses to read must not clear the
        // earlier sources either, or the property disappears with nothing put
        // in its place — the same 'a source deletes a value it never replaces'
        // shape the conditional guard above closes. '__velarMergeRules' spells
        // the test the same way.
        const descriptor = __velarGraphOwnDescriptor(source.rules, names[index]);
        if (!descriptor || !("value" in descriptor)) continue;
        if (!__velarLookUnconditional(names[index])) continue;
        const surface = __velarLookSurface(names[index]);
        for (let other = 0; other < owned.length; other += 1) {
          if (groups[owned[other]] === group || __velarLookSurface(owned[other]) !== surface) continue;
          delete merged[owned[other]];
          delete groups[owned[other]];
        }
      }
      for (let index = 0; index < names.length; index += 1) {
        const descriptor = __velarGraphOwnDescriptor(source.rules, names[index]);
        if (!descriptor || !("value" in descriptor)) continue;
        merged[names[index]] = descriptor.value;
        groups[names[index]] = group;
      }
    }
  }
  // The last value written per token, so a reactive change to one dynamic
  // property costs one DOM write instead of one per token plus a full attribute
  // rewrite (LOK-U15).
  const state = __velarElementState(element, "__velarLookTokens", () => __velarGraphFreeze({
    tokens: __velarGraphCreateSet(), written: { record: __velarGraphCreateRecord(), attribute: undefined },
  }));
  const written = state.written.record;
  const tokens = __velarGraphOwnNames(merged);
  const next = __velarGraphCreateSet(tokens);
  for (const token of __velarGraphSetItems(state.tokens)) {
    if (__velarGraphSetContains(next, token)) continue;
    __velarDomStyleClear(element, __velarLookVariable(token));
    delete written[token];
  }
  let attribute = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const value = __velarGraphOwnDescriptor(merged, token)?.value;
    const text = value == null ? null : __velarLookValue(token, value);
    if (!(token in written) || written[token] !== text) {
      if (text === null) __velarDomStyleClear(element, __velarLookVariable(token));
      else __velarDomStyleWrite(element, __velarLookVariable(token), text);
      written[token] = text;
    }
    attribute = attribute === "" ? token : attribute + " " + token;
  }
  const desired = tokens.length === 0 ? null : attribute;
  if (state.written.attribute !== desired) {
    if (desired === null) __velarDomRemoveAttribute(element, "data-velar-look");
    else __velarDomSetAttribute(element, "data-velar-look", desired);
    state.written.attribute = desired;
  }
  __velarGraphSetEmpty(state.tokens);
  for (let index = 0; index < tokens.length; index += 1) __velarGraphSetInsert(state.tokens, tokens[index]);
}

function __velarLookBind(element, read, scope) {
  const source = { rules: __velarGraphCreateRecord() };
  __velarAttachSource(__velarRuntime.lookSources, element, source);
  __velarObserver(() => {
    source.rules = __velarLook([read()]).rules;
    __velarApplyLooks(element);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarDetachSource(__velarRuntime.lookSources, element, source);
    __velarApplyLooks(element);
  });
}

function __velarMoveLookSource(source, previous, next) {
  if (previous) {
    __velarDetachSource(__velarRuntime.lookSources, previous, source);
    __velarApplyLooks(previous);
  }
  if (next) {
    __velarAttachSource(__velarRuntime.lookSources, next, source);
    __velarApplyLooks(next);
  }
}

function __velarApplyExternalLook(element, value) {
  const source = { rules: __velarLook([value]).rules };
  __velarAttachSource(__velarRuntime.lookSources, element, source);
  __velarApplyLooks(element);
  return () => {
    __velarDetachSource(__velarRuntime.lookSources, element, source);
    __velarApplyLooks(element);
  };
}

__velarRuntime.installLook(__velarApplyExternalLook);

// One resolution per root, shared by every capability bound to it: look, class
// and style used to pay a fresh O(subtree) walk each.
