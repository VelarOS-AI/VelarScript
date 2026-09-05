# @velarscript/core

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
