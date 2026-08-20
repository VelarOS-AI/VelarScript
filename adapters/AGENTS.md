# VelarScript Adapter Agent Guide

- Adapters are independently versioned npm source packages. They do not acquire
  compiler privileges, target syntax, hidden CLI dependencies, or `velar/*`
  names.
- Keep each native or third-party boundary narrow and checked. Validate values
  on both sides; never expose native handles through the public Velar API.
- Document and enforce memory, queue, result, cache, concurrency, cancellation,
  and cleanup behavior. Prefer backpressure and explicit rejection to unbounded
  buffering.
- Database adapters implement `@velarscript/database`; SQL, pools, workers, and
  raw escape hatches remain adapter-specific.
- Test source compilation, emitted code, real dependency execution, hostile
  bounds, overload, concurrency, and deterministic cleanup.
