# VelarScript Host Integration Agent Guide

- Integrations are independently versioned host/deployment packages. They do
  not gain compiler hooks, language keywords, `velar/*` modules, or toolchain
  release lockstep.
- Consume only documented provider-neutral artifacts and public package APIs.
  Never rewrite or forge compiler-owned manifests or their exact file inventory.
- Generate provider files outside the verified application directory whenever
  the provider supports a separate project/configuration root.
- Reject symbolic links and ambiguous paths, use isolated staging, and enforce
  entry-count and aggregate-byte ceilings while copying.
- Test provider projection, source immutability, deterministic output, failure
  cleanup, and independent package/release behavior.
