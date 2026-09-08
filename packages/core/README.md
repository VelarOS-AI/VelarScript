# @velarscript/core

**VelarScript 0.32.0 · Core surface `core@0.9`.** Every toolchain package steps
to the release number together; the surface counter is what says whether the
language you write changed. Core spans two packages by ruling: this one owns
the standard modules, `@velarscript/compiler` owns the words and the types, and
both hash into `core`.

The target-neutral VelarScript Standard API. This package owns the checked
contracts, dependency graph, and runtime sources for modules that work across
official targets. It does not select Node, Web, or Desktop capabilities.

This includes `velar/hash`, whose bounded synchronous SHA-256 implementation is
identical across all official targets, and `velar/validation`, which composes
semantic rules on top of compiler-owned runtime `Type` parsing without adding a
second schema system.

Hosts compose these Core modules with explicit compiler extensions. The CLI
keeps a compatibility facade that selects the Node extension when no narrower
target has been chosen.
