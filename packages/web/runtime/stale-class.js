/**
 * D114 P6 item 7 (ST-U4), completed by F9-web (WB-I3 / WB-I4 / WB-U4): the
 * development host's detector for a `computed`, a `watch` subject or a DOM
 * interpolation that reads a field of a class instance held in `state`.
 *
 * web-api's rule stands and is not changing: classes are never wrapped, because
 * a proxy over an instance would change what `self` is and what identity means.
 * The consequence had no name: `state box = Counter()` with
 * `computed shown = box.value` compiles clean, renders once, and never updates
 * again, because `box.bump()` writes a field nothing is watching. Only
 * replacing the cell publishes. `<p>{box.value}</p>` is the same fact one step
 * closer to the page -- the text node is written once and never again -- so the
 * three readers are one rule and earn one sentence.
 *
 * So the instance's own data fields are observed while a development host is
 * present -- the same trade the frozen-read detector makes, in the same
 * channel. The instance is not replaced: an accessor pair over the value it
 * already held keeps its identity, its prototype, and what `self` means inside
 * its own methods, which a proxy could not. A production build publishes no
 * hooks, so none of this exists there.
 *
 * Three things this file owns that the report did not have before:
 *
 *   - **What to write instead (WB-I3).** The remedy used to be spelled
 *     `cell = Class(...)` whatever shape the value was in, and the walk that
 *     finds the cell climbs through records and Lists -- so `state holder =
 *     {box: Box()}` was told to write `holder = Box(...)`, which does not
 *     compile. The walk now carries the path it climbed, and the remedy is
 *     written for the shape that actually holds the instance.
 *   - **When the read has actually gone stale (WB-I4).** A `const` field is one
 *     nothing can change, so a read of it can never go stale and the sentence
 *     "changing 'value' publishes nothing" describes something that will not
 *     happen. The emitted class makes `const` and `let` the same ordinary data
 *     property, so the runtime cannot tell them apart by looking -- but it does
 *     not have to: the report is made when the field is **written** under a
 *     reader that cannot see it, which is the frozen-read detector's own rule
 *     ("a report is made when one of them later changes -- never when it is
 *     read"). A field nothing writes is never reported, and `const` is exactly
 *     the case where nothing can.
 *   - **The member the line reads (WB-U4).** `get shown()` backed by a field
 *     `inner` was reported as `inner`, a name the author's line never contains
 *     and may not know exists. A read that enters through the class's own
 *     getter or method records that member for as long as it runs, so the
 *     report can name both.
 */
const __velarStaleClassHooks = (() => {
  const hooks = globalThis.__velarDevelopmentHooks;
  return hooks && typeof hooks.frozenRead === "function" ? hooks : null;
})();
const __velarStaleClassSeen = __velarStaleClassHooks === null ? null : __velarGraphCreateWeakSet();
const __velarStaleClassWrapped = __velarStaleClassHooks === null ? null : __velarGraphCreateWeakSet();
const __velarStaleClassReported = __velarStaleClassHooks === null ? null : __velarGraphCreateSet();
// The class member a read is currently inside, or null when the reading line
// names the field itself. Outermost wins: a method that reads through a getter
// of its own is still entered as the method the author wrote.
let __velarStaleClassMember = null;

/** The written class name, or null where the value is not an instance of one. */
function __velarStaleClassName(instance) {
  const prototype = __velarGraphPrototype(instance);
  if (prototype === null) return null;
  const constructor = __velarGraphOwnDescriptor(prototype, "constructor");
  const value = constructor && "value" in constructor ? constructor.value : null;
  if (typeof value !== "function") return null;
  const named = __velarGraphOwnDescriptor(value, "name");
  const name = named && "value" in named ? named.value : null;
  return typeof name === "string" && name !== "" ? name : null;
}

/**
 * Which slot of `owner` holds `child`: a record field, a List index, or null
 * where the owner is a shape whose slot has no spelling an author can write --
 * a `Map`, a `Set`, or an owner that no longer references the child at all. A
 * slot that cannot be named is a remedy that cannot be written, and the report
 * says so rather than inventing one.
 */
function __velarStaleClassSlot(owner, child) {
  if (owner === null || typeof owner !== "object") return null;
  if (__velarGraphIsList(owner)) {
    for (let index = 0; index < owner.length; index += 1) {
      const descriptor = __velarGraphOwnDescriptor(owner, index);
      if (descriptor && "value" in descriptor && descriptor.value === child) return { index, field: null };
    }
    return null;
  }
  if (!__velarGraphIsRecord(owner)) return null;
  for (const name of __velarGraphOwnNames(owner)) {
    const descriptor = __velarGraphOwnDescriptor(owner, name);
    if (descriptor && "value" in descriptor && descriptor.value === child) return { index: -1, field: name };
  }
  return null;
}

/**
 * The `state` cell a value was reached through and the path from that cell down
 * to it, or null when no cell is above it. The walk is bounded and
 * breadth-first over the same ownership graph a deep change bubbles up, so a
 * class instance held one or two records below a state cell is found -- and a
 * value that is not under one is not reported about at all, because the report
 * has to name the place whose replacement publishes.
 *
 * `steps` is null when some owner on the path holds the value in a slot with no
 * written spelling; the cell is still named, and the remedy drops to the one
 * sentence that is true for every shape.
 */
function __velarStaleClassLocation(instance, parent) {
  const seen = __velarGraphCreateSet();
  let frontier = [{ value: parent, child: instance, steps: [] }];
  for (let depth = 0; depth < 8 && frontier.length > 0; depth += 1) {
    const next = [];
    for (const entry of frontier) {
      const candidate = entry.value;
      if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) continue;
      if (__velarGraphSetContains(seen, candidate)) continue;
      __velarGraphSetInsert(seen, candidate);
      const descriptor = __velarGraphOwnDescriptor(candidate, "velarStateName");
      const name = descriptor && "value" in descriptor ? descriptor.value : null;
      // A cell holds its value in a closure rather than in a slot, so the step
      // into it is the cell itself and the path collected so far is complete.
      if (typeof name === "string" && name !== "") return { cell: name, steps: entry.steps };
      const owners = __velarGraphWeakMapRead(__velarRuntime.parents, candidate);
      if (!owners) continue;
      const slot = __velarStaleClassSlot(candidate, entry.child);
      let steps = null;
      if (slot !== null && entry.steps !== null) {
        steps = [slot];
        for (let index = 0; index < entry.steps.length; index += 1) steps[steps.length] = entry.steps[index];
      }
      for (const above of __velarGraphSetItems(owners)) next[next.length] = { value: above, child: candidate, steps };
    }
    frontier = next;
  }
  return null;
}

/** `holder.box`, `boxes[0]`, `groups[0].box` -- the path an author can read the value through. */
function __velarStaleClassPath(cell, steps, count) {
  let text = cell;
  for (let index = 0; index < count; index += 1) {
    const step = steps[index];
    text += step.field === null ? "[" + step.index + "]" : "." + step.field;
  }
  return text;
}

/**
 * The write that publishes, for the shape the instance is actually in. The flat
 * case replaces the cell; a record below it is replaced with the field written
 * over, which is the update every other record in `state` takes; a List element
 * is replaced by index.
 */
function __velarStaleClassRemedy(location, className) {
  const steps = location.steps;
  if (steps === null) return "only replacing the value in state '" + location.cell + "' that holds it publishes.";
  if (steps.length === 0) return "only replacing the cell -- '" + location.cell + " = " + className + "(...)' -- publishes.";
  const last = steps[steps.length - 1];
  const owner = __velarStaleClassPath(location.cell, steps, steps.length - 1);
  if (last.field === null) {
    return "only replacing the element -- '" + owner + "[" + last.index + "] = " + className + "(...)' -- publishes.";
  }
  return "only replacing it -- '" + owner + " = {..." + owner + ", " + last.field + ": " + className + "(...)}' -- publishes.";
}

/** The reading line, captured where the read happens rather than where the report is made. */
function __velarStaleClassSite() {
  const site = new Error("velar stale class read");
  try { return typeof site.stack === "string" ? site.stack : ""; } catch { return ""; }
}

/**
 * One mistake, one sentence, once per place, class and field -- whichever of
 * the three readers reached it first. Only the words that name the reader
 * change: a `computed` and a `watch` subject are a reactive value, and a
 * position in the document is the interpolation that wrote it.
 */
function __velarReportStaleClassField(location, className, field, member, mode, stack) {
  const named = typeof member === "string" && member !== "" && member !== field ? member : null;
  const path = location.steps === null || location.steps.length === 0
    ? "" : " at '" + __velarStaleClassPath(location.cell, location.steps, location.steps.length) + "'";
  // Keyed by the place and the field, not by the member: two members that read
  // one field are two lines about one field that does not publish, and the
  // report names whichever reader reached it first, as it always has.
  const key = location.cell + "|" + path + "|" + className + "|" + field;
  if (__velarGraphSetContains(__velarStaleClassReported, key)) return;
  __velarGraphSetInsert(__velarStaleClassReported, key);
  const reader = mode === "dom" ? "interpolation" : "value";
  __velarStaleClassHooks.frozenRead({
    message: "This " + (mode === "dom" ? "interpolation" : "reactive value") + " reads '" + (named ?? field) + "' on the "
      + className + " held in state '" + location.cell + "'" + path + "."
      + (named === null ? "" : " '" + named + "' reads the field '" + field + "'.")
      + " A class instance is never wrapped, so changing '" + field
      + "' publishes nothing and this " + reader + " stays as it is: "
      + __velarStaleClassRemedy(location, className)
      + " Hold the field in its own 'state' if it is meant to be followed.",
    stack,
  });
}

/**
 * Observes one instance's own writable data fields. Fields the class did not
 * declare as plain values -- a getter it wrote itself, a sealed field -- are
 * left exactly as they are: this detector may not change what the program does,
 * only notice what it cannot see.
 *
 * The report is made when a reader that cannot follow the field meets a real
 * change to it, in whichever order the two arrive: a read that is already stale
 * reports on the spot, and a read of a value that changes later reports at the
 * change, on the line the read was made. A field that never changes is never
 * reported, which is what keeps a `const` field silent (WB-I4).
 */
function __velarObserveClassFields(instance, parent) {
  if (__velarGraphWeakSetContains(__velarStaleClassSeen, instance)) return;
  __velarGraphWeakSetInsert(__velarStaleClassSeen, instance);
  const className = __velarStaleClassName(instance);
  if (className === null) return;
  const location = __velarStaleClassLocation(instance, parent);
  if (location === null) return;
  let observed = false;
  for (const field of __velarGraphOwnNames(instance)) {
    const descriptor = __velarGraphOwnDescriptor(instance, field);
    if (!descriptor || !("value" in descriptor) || !descriptor.writable || !descriptor.configurable) continue;
    observed = true;
    let held = descriptor.value;
    let waiting = null;
    let moved = false;
    __velarGraphDefine(instance, field, {
      enumerable: descriptor.enumerable,
      configurable: true,
      // Named, not shorthand, for the frozen-read detector's reason: the
      // development host walks past its own frames to find the reading line,
      // and every engine spells an anonymous accessor differently.
      get: function __velarStaleClassFieldRead() {
        const observer = __velarRuntime.activeObserver;
        // Every mode an observer has is a reader that re-runs only when a
        // dependency it tracked changes, and this field is never one: the
        // rendering tier ("dom") is as stuck as the derivation tier.
        if (observer !== null && (observer.mode === "computed" || observer.mode === "watch" || observer.mode === "dom")) {
          if (moved) __velarReportStaleClassField(location, className, field, __velarStaleClassMember, observer.mode, __velarStaleClassSite());
          else if (waiting === null) waiting = { mode: observer.mode, member: __velarStaleClassMember, site: __velarStaleClassSite() };
        }
        return held;
      },
      set: function __velarStaleClassFieldWrite(next) {
        if (__velarGraphSame(held, next)) return;
        held = next;
        moved = true;
        if (waiting === null) return;
        const claim = waiting;
        waiting = null;
        __velarReportStaleClassField(location, className, field, claim.member, claim.mode, claim.site);
      },
    });
  }
  if (observed) __velarObserveClassMembers(instance);
}

/**
 * Records which of the class's own members a read entered through, so a report
 * can name the one the author's line contains as well as the field underneath
 * it. Only the prototype of an instance whose fields this detector already took
 * over is touched, and only in a development host: an object it observes
 * nothing on is one it has no report to make about either.
 */
function __velarObserveClassMembers(instance) {
  const prototype = __velarGraphPrototype(instance);
  if (prototype === null || __velarGraphWeakSetContains(__velarStaleClassWrapped, prototype)) return;
  __velarGraphWeakSetInsert(__velarStaleClassWrapped, prototype);
  for (const member of __velarGraphOwnNames(prototype)) {
    // The compiler owns its own contracts -- `@dispose:` emits `__velar:dispose`
    // -- and a member the author did not write is not one their line names.
    if (member === "constructor" || member.indexOf("__velar") === 0 || member.indexOf(":") >= 0) continue;
    const descriptor = __velarGraphOwnDescriptor(prototype, member);
    if (!descriptor || !descriptor.configurable) continue;
    if (typeof descriptor.get === "function" && descriptor.set === undefined) {
      const read = descriptor.get;
      __velarGraphDefine(prototype, member, {
        enumerable: descriptor.enumerable,
        configurable: true,
        get: function __velarStaleClassMemberRead() { return __velarStaleClassEnter(member, read, this, []); },
      });
      continue;
    }
    if (!("value" in descriptor) || typeof descriptor.value !== "function") continue;
    const call = descriptor.value;
    __velarGraphDefine(prototype, member, {
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: descriptor.writable,
      value: function __velarStaleClassMemberCall(...values) { return __velarStaleClassEnter(member, call, this, values); },
    });
  }
}

function __velarStaleClassEnter(member, operation, receiver, values) {
  const outer = __velarStaleClassMember;
  if (outer === null) __velarStaleClassMember = member;
  try { return __velarGraphApply(operation, receiver, values, "class member"); }
  finally { __velarStaleClassMember = outer; }
}
