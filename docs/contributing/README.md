# Contributor documentation

These documents are for people working **on** VelarScript, not with it; if you
are building an application, everything you need is in the user documentation
one directory up.

- [Compiler architecture](compiler-architecture.md) — package boundaries and
  where each compilation stage lives.
- [Runtime and JavaScript boundary ledger](runtime-boundary.md) — the
  classified ledger of every point where observable semantics cross into
  generated JavaScript and the host runtime.
- [Release process](release-process.md) — the non-publishing rehearsal and the
  publishing sequence for the toolchain packages.
- [Continuous integration](continuous-integration.md) — what CI runs and what
  each gate is responsible for proving.
- [Workbench integration](workbench-integration.md) — how the editor consumes
  a packed toolchain, and why compiler source is never linked into it.
