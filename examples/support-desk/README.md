# SupportDesk

SupportDesk is the second independent real application used to mature Velar's
language and Web platform. It validates typed route context, route-pattern
contracts, static HTTP data loading, native-form extraction, accessible field
errors, enum parsing, pagination, sorting, persisted edits, and browser-driven
detail routes without exposing browser globals. Direct detail URLs recover
their data through component-owned `resource` declarations before deciding
whether a ticket is missing, failed loads expose an accessible retry instead of
duplicated lifecycle state, `NavLink` exposes the active application route
accessibly, and status changes use a typed native `dialog` boundary rather than
an application-owned DOM wrapper. The native form, store, and domain creation
path share one `TicketDraft` record; object spread/shorthand replaces a fragile
six-argument call without introducing a second schema.

```sh
npm run velar -- check examples/support-desk
npm run velar -- test examples/support-desk
npm run velar -- test examples/support-desk --browser all
npm run velar -- build examples/support-desk
npm run velar -- verify examples/support-desk/dist
```

This application remains part of the language/Web work. It does not start the
later Canvas-oriented `velar/game` package.
