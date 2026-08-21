import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY, VELAR_PROMISE_NORMALIZATION_RUNTIME } from "@velarscript/compiler/extension";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

interface NormalizationRuntime {
  normalize(value: unknown): Promise<unknown>;
  resolved(value: unknown): unknown;
}

function loadNormalizationRuntime(): NormalizationRuntime {
  return new Function(`${VELAR_PROMISE_NORMALIZATION_RUNTIME}
return { normalize: __velarNormalizePromiseValue, resolved: __velarAsyncResolvedValue };`)() as NormalizationRuntime;
}

test.after(async () => {
  await removeTemporaryDirectories();
});

test("a species-hijacked Promise cannot smuggle a foreign thenable into checked code", async () => {
  const result = compile(`
extern js()\`
    function Fake(executor) { executor(() => {}, () => {}); return { then(onFulfilled) { onFulfilled(undefined) } } }
    Fake[Symbol.species] = Fake
    export function load() { const p = Promise.resolve("real value"); p.constructor = Fake; return p }
\`:
    export async def load() -> string

async def main():
    const value = await load()
    print(f"got: {value}")

await main()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /await __velarNormalizePromiseValue\(load\(\)\)/u);

  const directory = await makeTemporaryDirectory("velar-promise-species-");
  for (const embedded of result.embeddedModules) {
    await writeFile(join(directory, embedded.specifier.replace(/^\.\//u, "")), embedded.code, "utf8");
  }
  const entry = join(directory, "main.mjs");
  await writeFile(entry, result.code ?? "", "utf8");
  const execution = spawnSync(process.execPath, [entry], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  // A binding declared `string` must never observe raw JavaScript `undefined`:
  // the value the host actually resolved is the only acceptable outcome.
  assert.equal(execution.stdout, "got: real value\n");
});

test("normalization owns the identity it caches rather than the one 'then' derives", async () => {
  const { normalize } = loadNormalizationRuntime();

  const promise = Promise.resolve("ok");
  const first = normalize(promise);
  const second = normalize(promise);
  assert.equal(first, second);
  assert.equal(normalize(first), first);
  assert.equal(Object.getPrototypeOf(first), Promise.prototype);
  assert.equal(await first, "ok");

  function Fake(executor: (resolve: () => void, reject: () => void) => void) {
    executor(() => {}, () => {});
    return { then(onFulfilled: (value: unknown) => void) { onFulfilled(undefined); } };
  }
  (Fake as unknown as Record<symbol, unknown>)[Symbol.species] = Fake;
  const hijacked = Promise.resolve("real value");
  hijacked.constructor = Fake as unknown as PromiseConstructor;
  const normalized = normalize(hijacked);
  assert.equal(Object.getPrototypeOf(normalized), Promise.prototype);
  assert.equal(await normalized, "real value");

  // A hostile species that refuses to build a capability at all fails closed
  // with the owned message instead of handing back whatever it returned.
  function Explode() { throw new Error("hostile species"); }
  (Explode as unknown as Record<symbol, unknown>)[Symbol.species] = Explode;
  const exploding = Promise.resolve("x");
  exploding.constructor = Explode as unknown as PromiseConstructor;
  assert.throws(() => normalize(exploding), /Expected an actual Promise/u);

  class Subclassed<T> extends Promise<T> {}
  const subclassed = normalize(Subclassed.resolve("sub"));
  assert.equal(Object.getPrototypeOf(subclassed), Promise.prototype);
  assert.equal(await subclassed, "sub");
});

test("normalization keeps its resolution, rejection, and non-Promise contracts", async () => {
  const { normalize, resolved } = loadNormalizationRuntime();

  assert.equal(await normalize(Promise.resolve(undefined)), null);
  await assert.rejects(normalize(Promise.reject(new Error("boom"))), /boom/u);
  assert.throws(() => normalize({ then() {} }), /Expected an actual Promise/u);
  assert.throws(() => normalize(42), /Expected an actual Promise/u);
  assert.throws(() => normalize(null), /Expected an actual Promise/u);

  assert.equal(resolved(undefined), null);
  assert.equal(await (resolved(Promise.resolve("via")) as Promise<string>), "via");
  assert.equal(Object.getPrototypeOf(resolved(Promise.resolve("via"))), Promise.prototype);
  assert.throws(() => resolved({ then() {} }), /must not expose a callable 'then'/u);
});

type Executor = (resolve: (value?: unknown) => void, reject: (reason?: unknown) => void) => void;

function hijack(value: string, constructor: unknown): Promise<unknown> {
  const promise = Promise.resolve(value);
  promise.constructor = constructor as PromiseConstructor;
  return promise;
}

// The filed attack reassigned `constructor` on an ordinary `Promise.resolve()`
// result. Every shape below reaches the same `SpeciesConstructor` read by a
// different route, and each one yielded a wrong value — or no value at all —
// while normalization cached whatever `then` derived. Two of them need no
// hostile species: a Promise subclass is legal JavaScript, and overriding
// `then` on one is the shortest path to the same smuggling.
test("no route through SpeciesConstructor can displace the normalized value", async () => {
  const { normalize } = loadNormalizationRuntime();

  // A Proxy stands in for the constructor and answers `Symbol.species` itself.
  const derived = { then(onFulfilled: (value: unknown) => void) { onFulfilled(undefined); } };
  const proxied: unknown = new Proxy(function Fake(executor: Executor) {
    executor(() => {}, () => {});
    return derived;
  }, {
    get(target, key, receiver) { return key === Symbol.species ? proxied : Reflect.get(target, key, receiver); },
  });
  const throughProxy = normalize(hijack("proxy target", proxied));
  assert.equal(await throughProxy, "proxy target");
  assert.notEqual(throughProxy, derived);

  // `Symbol.species` behind a getter rather than a data property.
  function Getter(executor: Executor) { executor(() => {}, () => {}); return derived; }
  Object.defineProperty(Getter, Symbol.species, { get() { return Getter; } });
  assert.equal(await normalize(hijack("getter species", Getter)), "getter species");

  // The species-derived thenable settles twice, and settles then throws. It is
  // never the value awaited, so neither reaches the caller: normalization holds
  // its own capability and `then` only ever proved the input.
  function Twice(executor: Executor) {
    executor(() => {}, () => {});
    return { then(onFulfilled: (value: unknown) => void) { onFulfilled("A"); onFulfilled("B"); } };
  }
  (Twice as unknown as Record<symbol, unknown>)[Symbol.species] = Twice;
  assert.equal(await normalize(hijack("truth", Twice)), "truth");

  function Throws(executor: Executor) {
    executor(() => {}, () => {});
    return { then(onFulfilled: (value: unknown) => void) { onFulfilled("A"); throw new Error("derived"); } };
  }
  (Throws as unknown as Record<symbol, unknown>)[Symbol.species] = Throws;
  assert.equal(await normalize(hijack("truth", Throws)), "truth");

  // A species that never settles used to hang the await forever, which is a
  // denial of the result rather than a wrong one — still a value a binding
  // declared `string` never receives.
  function Never(executor: Executor) { executor(() => {}, () => {}); return { then() {} }; }
  (Never as unknown as Record<symbol, unknown>)[Symbol.species] = Never;
  const starved = await Promise.race([
    normalize(hijack("not starved", Never)),
    new Promise((resolve) => { setTimeout(() => resolve("TIMED OUT"), 50); }),
  ]);
  assert.equal(starved, "not starved");

  // A species that refuses to build a capability at all, and the two accessor
  // shapes that throw before one can be built, all fail closed. Failing closed
  // is the acceptable outcome; producing a wrong value is not.
  function Silent() {}
  (Silent as unknown as Record<symbol, unknown>)[Symbol.species] = Silent;
  assert.throws(() => normalize(hijack("x", Silent)), /Expected an actual Promise/u);

  const throwingConstructor = Promise.resolve("x");
  Object.defineProperty(throwingConstructor, "constructor", {
    get() { throw new Error("constructor getter"); },
    configurable: true,
  });
  assert.throws(() => normalize(throwingConstructor), /Expected an actual Promise/u);

  function ThrowingSpecies(executor: Executor) { executor(() => {}, () => {}); }
  Object.defineProperty(ThrowingSpecies, Symbol.species, { get() { throw new Error("species getter"); } });
  assert.throws(() => normalize(hijack("x", ThrowingSpecies)), /Expected an actual Promise/u);
});

// Subclassing Promise is ordinary JavaScript, so normalization must keep
// working on a subclass rather than refusing one. It must also not consult the
// subclass's own `then`: normalization calls the captured `%Promise.prototype%`
// intrinsic, so an override cannot observe the probe or answer it.
test("a Promise subclass is normalized without its own 'then' being consulted", async () => {
  const { normalize } = loadNormalizationRuntime();

  let overrideCalls = 0;
  class Hostile<T> extends Promise<T> {
    override then<A = T, B = never>(
      onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
      onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): Promise<A | B> {
      overrideCalls += 1;
      return super.then(() => (onFulfilled as (value: unknown) => A)(undefined as never), onRejected);
    }
  }

  const normalized = normalize(Hostile.resolve("subclass truth"));
  assert.equal(Object.getPrototypeOf(normalized), Promise.prototype);
  assert.equal(await normalized, "subclass truth");
  assert.equal(overrideCalls, 0);

  // The `undefined` resolution rule holds across the subclass boundary too.
  class Plain<T> extends Promise<T> {}
  assert.equal(await normalize(Plain.resolve(undefined)), null);
});

// D90 fr-8 — the normalization cache is one immutable per-realm WeakMap, and
// until now its key carried no generation: whichever module loaded first owned
// it for every generation in the realm, so a later generation read normalized
// identities a foreign one had built. The key now ends in the generation from
// `VELAR_PROMISE_NORMALIZATION_REGISTRY_VERSION`, so a bump claims a separate
// global slot. Nothing evicts, by design — the map is keyed by the source
// Promise and an entry is released with it.
test("one generation converges on a cache and the next generation gets its own", async () => {
  assert.match(VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY, /^velar\.promise\.normalization\.v\d+$/u);
  assert.ok(VELAR_PROMISE_NORMALIZATION_RUNTIME.includes(JSON.stringify(VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY)));

  const promise = Promise.resolve("shared");
  const first = loadNormalizationRuntime().normalize(promise);
  // A second module of the same generation must reuse the identity, which is
  // what the shared registry exists for.
  assert.equal(loadNormalizationRuntime().normalize(promise), first);

  const nextGeneration = new Function(`${VELAR_PROMISE_NORMALIZATION_RUNTIME.replace(
    JSON.stringify(VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY),
    JSON.stringify(`${VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY}-next`),
  )}
return { normalize: __velarNormalizePromiseValue, resolved: __velarAsyncResolvedValue };`)() as NormalizationRuntime;
  const foreign = nextGeneration.normalize(promise);
  assert.notEqual(foreign, first);
  assert.equal(nextGeneration.normalize(promise), foreign);
  assert.equal(await foreign, "shared");
});
