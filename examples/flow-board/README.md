# FlowBoard

FlowBoard is the first independent application used to mature Velar 0.8F. It
is a real nine-module project rather than a compiler showcase page.

It exercises:

- string-backed workflow and priority enums;
- immutable task creation, movement, deletion, search, and filtering;
- secure `velar/id` UUID generation;
- validated local-storage persistence and reload recovery;
- native JSX, scoped CSS, enum select binding, keyed lists, and accessible UI;
- typed Map entry snapshots in a lazy analytics route;
- transparent callback aliases shared through the domain module without store coupling;
- one typed `TaskDraft` command record with object shorthand instead of positional creation arguments;
- unit tests plus Chromium, Firefox, and WebKit application tests; and
- a CSP-enabled, source-mapped production build accepted by `velar verify`.

```sh
npm run velar -- check examples/flow-board
npm run velar -- test examples/flow-board
npm run velar -- test examples/flow-board --browser all
npm run velar -- build examples/flow-board
npm run velar -- verify examples/flow-board/dist
```

The app intentionally does not include `velar/game`; Canvas/game work remains a
later package after the language and Web platform are stable.
