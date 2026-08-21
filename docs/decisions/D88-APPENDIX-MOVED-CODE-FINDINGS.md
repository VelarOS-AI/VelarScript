# D88 附录：随代码移出仓库的审计结论

D88 把 `adapters/*`、`libraries/*`、`integrations/*` 移出本仓库。移出**之前**，
一次覆盖语言、编译器与框架的全面审计在那些实现里确认了若干缺陷（全审计 269 条
上报、60 条被对抗式验证推翻、205 条确认）。

这些结论不随代码作废，只是换了归属：

- **compression、msgpack、noise、text-buffer** 已迁入
  [VelarScript-Libraries](https://github.com/VelarOS-AI/VelarScript-Libraries)。
  落在它们身上的 10 条已在那个仓库处理。
- **sqlite、database、script-analysis** 至今没有落脚点。下列 12 条留在这里，
  作为这些实现重建时的现成用例清单。

代码本身仍可从 `git show aa4723a:adapters/sqlite/src/index.vel` 一类命令取回。
每一条都经过对抗式验证——不是猜测，是复现过的。


代码仍可从主仓 `git show aa4723a:adapters/sqlite/src/index.vel` 等处取回。
下面每一条都经过对抗式验证，可以在这些实现重建时直接当作用例清单使用。

---

## 1. [high/design] `verify-deployment` requires `Cache-Control: no-cache` on SPA deep routes that `velar-deploy.json` never assigns a Cache-Control to — only `velar preview` supplies it out-of-band

**原始位置** `packages/cli/src/deployment-verifier.ts:104-113, packages/cli/src/static-deployment.ts:118-137, packages/cli/src/preview-server.ts:78-79, integrations/netlify/dist/index.js:72-79`

The deployment manifest enumerates Cache-Control only for `assets/*` and five exact document paths. Every other HTML navigation — the whole point of `spaFallback` — falls through to the provider's default. Yet the verifier hard-requires `deployment.caching.documents` (`"no-cache"`) on a synthetic deep route. The only reason the round trip passes is that `velar preview` adds a rule the manifest does not express. A provider that implements `velar-deploy.json` literally — including the repo's own `@velarscript/netlify` projection — fails verification, and worse, may cache the fallback HTML.

**Evidence**

```
static-deployment.ts:119-125 — `const documentPaths = [config.base, `${config.base}index.html`, `${config.base}velar-build.json`, `${config.base}${STATIC_DEPLOYMENT_MANIFEST_NAME}`, ...(config.spaFallback ? [`${config.base}${STATIC_FALLBACK_NAME}`] : [])];` — no wildcard for arbitrary routes.
deployment-verifier.ts:104-113 — `const route = await verifyResponse(build, routeUrl, build.deployment.spaFallback.source, [200], fetcher, {...}, build.deployment.caching.documents);` where `routeUrl` is `${base}__velar_verify__/route-<12hex>`.
preview-server.ts:78-79 — `if (!response.hasHeader("Cache-Control") && contentType.startsWith("text/html")) { response.setHeader("Cache-Control", build.deployment.caching.documents); }` — the missing rule, invented by velar's own server.
integrations/netlify/dist/index.js:72-79 — `for (const rule of manifest.headers) { lines.push("", "[[headers]]", `for = ${tomlString(rule.path)}`, "[headers.values]"); ... }` — emits exactly the manifest rules and nothing else.
```

**Failure scenario**

```
`velar build` then `npx velar-netlify dist netlify-bundle` then `velar verify-deployment --url https://site.example`. Netlify serves `/board/123` through `[[redirects]] from="/*" to="/index.html" status=200`; the request path matches only the `/*` security-header rule, so Cache-Control is Netlify's HTML default (`public, max-age=0, must-revalidate`). `verifyHeaders` does an exact normalized string compare (deployment-verifier.ts:275), so verification aborts with `Deployment header 'Cache-Control' for '/__velar_verify__/route-…' is 'public, max-age=0, must-revalidate', expected 'no-cache'`. On a provider whose HTML default is a positive TTL (S3+CloudFront's 24h default), the failure is real rather than cosmetic: a user who bookmarked `/board/123` gets yesterday's `index.html`, which points at `assets/main-OLDHASH.js`; that file no longer exists because `replaceOutputDirectory` swaps the whole tree, and Netlify's own `[[redirects]] from="/assets/*" status=404` turns the script request into a 404 — a blank app, while `velar verify-deployment` against the deep route is the only check that would have caught it.
```

**当时如何验证的** Confirmed by construction and by execution. The built dist/velar-deploy.json for examples/app has exactly seven header rules — /* (security only), /assets/*, /, /index.html, /velar-build.json, /velar-deploy.json, /404.html — and matchesPath (deployment-verifier.ts:350-352) makes /* match everything but it carries no Cache-Control. deployment-verifier.ts:96-113 passes build.deployment.caching.documents as requiredCacheControl for the synthetic /__velar_verify__/route-<12hex>, and verifyHeaders (275) does an exact normalized string compare. preview-server.ts:78-79 injects the header the manifest does not express. integrations/netlify/src/index.ts (netlifyConfiguration) emits exactly manifest.headers plus the two redirects and nothing else — I read it from git HEAD (the integrations/ tree is deleted in the current working copy by a concurrent edit). I ran a server that reproduces that projection faithfully over a real dist and got verbatim: `velar verify-deployment: Deployment header 'Cache-Control' for '/__velar_verify__/route-b0ef8a224af5' is 'public, max-age=0, must-revalidate', expected 'no-cache'`. Swapping only that one default to no-cache made the same run pass. .github/workflows/external-preview-verification.yml runs exactly this round trip (prepare-external-preview → netlify bundle → verify-deployment), but it is workflow_dispatch-only, which is why CI never sees it.

**建议方向** Emit the rule the verifier enforces: add `{ path: `${config.base}*`, values: { "Cache-Control": "no-cache" } }` ordered before the `assets/*` rule (or a manifest-level `documentFallback` the providers project), so what is verified is what providers are told. Then delete the special case at preview-server.ts:78-79 so the preview server and a third-party provider are indistinguishable to `verify-deployment`.

---

## 2. [high/correctness] A stream consumer that issues any other database call deadlocks the connection forever — close() hangs too

**原始位置** `adapters/sqlite/src/index.vel:634 (worker message pump), :502-507 (acknowledge), :519/:529/:538 (await acknowledge), :549-552 (query.stream dispatch)`

The worker serializes every request onto a single promise chain `tail`, but a streaming query parks on that chain awaiting a `stream.ack` from the main thread. The main thread only sends that ack after the user's `consume` callback resolves. If `consume` issues any other database operation on the same connection, that operation's message is queued behind the still-running stream on `tail` and never dispatched, while the stream never acks. Both sides wait forever. Nothing times out, and `close()` is queued on the same chain so it hangs too — the connection and its Worker thread are permanently lost.

**Evidence**

```
adapters/sqlite/src/index.vel:634 — `tail = tail.then(() => dispatch(message), () => dispatch(message));`
adapters/sqlite/src/index.vel:502-507 — `function acknowledge(id, rows, transfers) { return new Promise((resolve, reject) => { acknowledgements.set(id, { resolve, reject }); parentPort.postMessage({ id, stream: true, rows }, transfers); }); }`
adapters/sqlite/src/index.vel:519 — `const keepGoing = await acknowledge(message.id, normalized, transfers);`
Main thread, :838-846 — `pending.chain = pending.chain.then(async () => { for (const row of message.rows) await pending.consume(row); state.worker.postMessage({ operation: "stream.ack", id: message.id, continue: true }); })`
docs/database-model.md: "Use `stream(query, consume)` when results may be large." — the doc advertises exactly this API with no warning against re-entrancy.
```

**Failure scenario**

```
`await database.stream(select(users), async user => { const posts = await database.find(select(articles, where=filter.equal(articles, "author", user.id))) ... })` — the canonical "stream rows, look something up per row" handler. First row is delivered, the nested `find` never returns, the stream never completes, and the request handler hangs forever holding a queue slot. I reproduced this exactly: consume row u0 printed, then nothing; after 4 s the process was still hung with 1 row consumed. A rescue `db.close()` from a timer also never resolved ("close ALSO HUNG"), so the Worker thread and file handle leak for the life of the process.
```

**当时如何验证的** CONFIRMED by reproduction. Extracted the `extern js()` block from `git show HEAD:adapters/sqlite/src/index.vel` (lines 14-896, byte-identical at aa4723a and current HEAD) and ran it under node v24.15.0 against `:memory:`. t3.mjs: `streamQuery` over 5 rows with a consumer that awaits `db.executeQuery(...)` printed `consume u0` and then hung; a 4s watchdog fired with consumed=1. t3b.mjs: a rescue `db.close()` from a timer raced against a 3s deadline printed `close HUNG`. Process stayed alive with the Worker never exiting. All cited code is accurate: `tail = tail.then(() => dispatch(message), () => dispatch(message))` (:634) serializes every non-ack message; `acknowledge` (:502-507) parks the streaming dispatch on a promise that only the main thread's `stream.ack` resolves; the main thread only posts that ack after `for (const row of message.rows) await pending.consume(row)` completes. Tried to refute three ways and failed: (a) `queueCapacity` does not rescue it — the default is 256 and only 2 requests are in flight, so no backpressure rejection fires (it would only fire at the fixture's `queueCapacity: 1`); (b) `close` does not bypass `tail` — only `stream.ack` does, verified in the message handler at :628-635; (c) no timeout exists anywhere on the request path. The behavior is not blessed anywhere: tests/fixtures/database-adapters/main.vel streams only into a `List.append` consumer, and D87 requires "终止失败必须结算等待者" and "关闭幂等", which this violates.

**建议方向** Either (a) detect re-entrancy: tag the connection as "streaming" and reject any non-ack request that arrives while a stream is parked, with a clear `SQLITE_REENTRANT_STREAM` error instead of a hang; or (b) make it work by dispatching non-stream messages out of band — keep `tail` for ordering but let the parked stream yield the chain (e.g. process the queue while `acknowledgements` is non-empty). At minimum, `stream.ack` already bypasses `tail`; `close` must bypass it as well so a wedged connection is always releasable.

---

## 3. [high/correctness] A SQLite auto-rollback permanently wedges the connection: commit, rollback and close all fail forever and the Worker leaks

**原始位置** `adapters/sqlite/src/index.vel:581-598 (commit/rollback/close), :766-772 (close error reset)`

The worker tracks transaction state in a shadow variable that it only clears after `COMMIT`/`ROLLBACK` succeeds. Several ordinary SQLite conditions roll a transaction back on their own (an `ON CONFLICT ROLLBACK` constraint, `INSERT OR ROLLBACK`, SQLITE_FULL, SQLITE_IOERR). When that happens the shadow variable stays non-zero while SQLite has no transaction, so `COMMIT` and `ROLLBACK` both fail with "no transaction is active" — and `close` executes the same `ROLLBACK` first, so `close()` throws too. `NativeDatabase.close()` then resets `state.closing`/`state.closePromise` and rethrows, so retrying never helps. The connection is permanently unusable and the Worker thread is never terminated.

**Evidence**

```
adapters/sqlite/src/index.vel:586-590 — `if (message.operation === "rollback") { database.exec("ROLLBACK"); transaction = 0; return null; }` (state cleared only on success)
adapters/sqlite/src/index.vel:591-598 — `if (message.operation === "close") { if (transaction !== 0) { database.exec("ROLLBACK"); transaction = 0; } statements.clear(); ... database.close(); ... }`
adapters/sqlite/src/index.vel:768-772 — `} catch (error) { state.closing = false; state.closePromise = null; throw error; }`
Contradicts adapters/sqlite/README.md: "deterministic migrations, explicit transaction ownership, and idempotent cleanup", docs/database-model.md: "`close`, `commit`, and `rollback` are idempotent", and D87: "关闭幂等".
```

**Failure scenario**

```
```
using tx = await database.begin()
await tx.execute("INSERT INTO t VALUES (2,'b')")
await tx.execute("INSERT OR ROLLBACK INTO t VALUES (3,'a')")  # UNIQUE conflict
```
SQLite rolls the transaction back itself. Reproduced: `commit -> THREW: cannot commit - no transaction is active`; `rollback -> THREW: cannot rollback - no transaction is active`; `db query -> THREW: Use the active Transaction while a transaction is open`; `close -> THREW: cannot rollback - no transaction is active`; `close again -> THREW` (same); process still alive 1.2 s later with the Worker never exiting. In a long-lived server this is one poisoned request permanently killing the database connection and leaking a thread. The same wedge is reachable through the public `Transaction.execute` escape hatch (adapters/sqlite/src/index.vel:1031) with a bare `"ROLLBACK"`.
```

**当时如何验证的** CONFIRMED by two independent reproductions. t11.mjs (`INSERT OR ROLLBACK` hitting a UNIQUE conflict inside a transaction): `commit -> THREW: cannot commit - no transaction is active`; `rollback -> THREW: cannot rollback - no transaction is active`; `db query -> THREW: Use the active Transaction while a transaction is open`; `close -> THREW: cannot rollback - no transaction is active`; and `close` threw identically on the 2nd and 3rd call; the process was still alive after 1.2s with the Worker never exiting. t7b.mjs (bare `tx.rawExecute("ROLLBACK")` via the adapter's public raw escape hatch) produced the identical permanent wedge. The code reads exactly as quoted: `transaction = 0` is assigned only *after* `database.exec("ROLLBACK")`/`"COMMIT"` returns (:581-590), the `close` branch executes the same unguarded `ROLLBACK` first (:591-598), and `NativeDatabase.close()` resets `state.closing = false; state.closePromise = null; throw error` in its catch (:768-772), so retrying can never make progress. This directly contradicts three written guarantees: docs/database-model.md "`close`, `commit`, and `rollback` are idempotent", adapters/sqlite/README.md "idempotent cleanup", and D87 "关闭幂等". No test covers it — tests/fixtures/database-adapters/main.vel only double-closes a healthy connection.

**建议方向** Never let cleanup depend on the shadow state being accurate: in the worker, wrap the `ROLLBACK` in commit/rollback/close in try/catch, clear `transaction = 0` in a `finally`, and always proceed to `database.close()` on `close`. Additionally, resync the shadow flag from the driver (`database.isTransaction` / `PRAGMA` or a try-`COMMIT`) after any statement error inside a transaction, and treat `close()` as terminal on the main thread (mark closed and terminate the Worker even when the worker reports an error).

---

## 4. [high/correctness] script-analysis re-lexes with no preceding-token context, so one typed space turns the rest of a line into a regex literal and silently drops rename occurrences

**原始位置** `libraries/script-analysis/src/index.vel:241-243, :368, :733`

`previousAllowsRegexp` decides `/` vs regex from the *local* `output` list of the current `lexScript` call, and returns `true` when that list is empty. The incremental path calls `lexScript(sourceCharacters(suffixSource), restart, diagnostics)` with a fresh empty `output`, so the re-lex always believes a regex is permitted at `restart`, regardless of the reused token immediately before it. Incremental analysis therefore diverges from full analysis on ordinary code, and everything built on the token stream — highlighting, `symbolAt`, `referencesAt`, `renameAt` — diverges with it.

**Evidence**

```
previousAllowsRegexp :241-243 — `def previousAllowsRegexp(tokens: List<ScriptToken>) -> bool:` / `if tokens.size == 0:` / `return true`
lexScript :368 — `if value == "/" and previousAllowsRegexp(output):`
ScriptDocument.apply :733 — `for token in lexScript(sourceCharacters(suffixSource), restart, diagnostics):`
```

**Failure scenario**

```
Document `let b = 1\nconst r = a / b / c\nuse(b)`. The user types one space immediately before the first `/` (`apply([{start:22,end:22,replacement:" "}])`). Restart lands on the `/`, the re-lex starts with an empty token list, and `/ b /` becomes a `regexp` token. Concretely observed: incremental tokens are `... identifier:"a" regexp:"/ b /" identifier:"c"` while a fresh `ScriptDocument` on the identical text gives `... identifier:"a" operator:"/" identifier:"b" operator:"/" identifier:"c"`. Then `renameAt(4, "bee")` returns `[{4,5},{35,36}]` incrementally but `[{4,5},{25,26},{35,36}]` on the fresh document — the refactor silently leaves one `b` behind and produces broken JavaScript. A randomised differential fuzz found 6 distinct divergences in 600 trials.
```

**当时如何验证的** CONFIRMED by reproduction, verbatim. Built text-buffer + script-analysis as one module (combined.vel, 0 diagnostics), then f3.mjs on 'let b = 1\nconst r = a / b / c\nuse(b)' with apply([{start:22,end:22,replacement:' '}]) — activity {restartOffset:22, tokensReused:8}. Incremental tokens: ... identifier:"a" regexp:"/ b /" identifier:"c" ...; a fresh ScriptDocument on the identical text gives ... identifier:"a" operator:"/" identifier:"b" operator:"/" identifier:"c" .... renameAt(4,'bee') incrementally returns edits [{4,5},{35,36}]; on the fresh document [{4,5},{25,26},{35,36}] — one occurrence silently dropped. Cause confirmed against source: :733 calls lexScript(sourceCharacters(suffixSource), restart, diagnostics) with a fresh empty `output`, and :241-243 returns true for an empty token list, so the '/' at restart is decided as a regex regardless of the reused identifier before it. This is not merely a full-vs-incremental divergence: division is the objectively correct lexing, so the incremental result is wrong, and renameAt then emits broken JavaScript. `git grep -n 'ScriptDocument\|renameAt' HEAD -- tests/` confirms no test compares incremental against full analysis.

**建议方向** Thread the lexer's restart context explicitly: pass the last reused token (or a boolean `regexpAllowed`) into `lexScript` and seed `previousAllowsRegexp` from it, and back `restart` up past any token that cannot be re-decided without deeper context. Add a full-vs-incremental differential property test — it is cheap and it catches this class immediately.

---

## 5. [medium/design] While any transaction is open, every non-transaction operation on the connection fails with a non-retryable error — no queuing

**原始位置** `adapters/sqlite/src/index.vel:438-441 (transactionId), :545 (operation preamble), :576 (unreachable branch)`

`operation()` calls `transactionId(0)` for every non-transaction request, which throws immediately if a transaction is open. So while one code path holds a transaction, every other `executeQuery`, `executeMutation`, `rawAll`, `prepare`, and even a second `transaction()` on the same `Database` hard-fails with `SQLITE_TRANSACTION` / `retryable: false`. Requests are not queued behind the transaction even though the worker already has a serialization chain (`tail`) that could do exactly that. In the Node server framework — where one `Database` is shared across concurrent request handlers via a provider — a single request opening a transaction breaks every request concurrent with it.

**Evidence**

```
adapters/sqlite/src/index.vel:438-441 —
```
function transactionId(value) {
  if (value === 0) {
    if (transaction !== 0) throw fail("Use the active Transaction while a transaction is open", "SQLITE_TRANSACTION", "transaction");
    return;
  }
```
adapters/sqlite/src/index.vel:545 — `if (message.operation !== "close") transactionId(tx);`
adapters/sqlite/src/index.vel:576 — `if (transaction !== 0) throw fail("SQLite transaction is already active", ...)` is dead code: `transactionId(0)` at :545 always throws first, so the second concurrent `transaction()` caller gets the confusing "Use the active Transaction while a transaction is open" instead.
docs/database-model.md: "It serializes connection work" — it does not; it rejects.
```

**Failure scenario**

```
Two HTTP handlers share one `Database` provider. Handler A: `using tx = await database.transaction()` then awaits a slow write. Handler B, concurrent: `await database.findOne(select(users, where=filter.equal(users, "id", id)))`. B throws `SqliteError("Use the active Transaction while a transaction is open", SQLITE_TRANSACTION, retryable=false)` → 500. I reproduced all four variants against `:memory:`: `db.executeQuery`, `db.rawAll`, `db.prepare`, and a second `db.transaction()` all threw `SQLITE_TRANSACTION` with `retryable=false` while one transaction was open; every one succeeded again after `tx.rollback()`.
```

**当时如何验证的** Behavior CONFIRMED exactly, but the framing is partly wrong. t1.mjs reproduced all four variants: `db.executeQuery`, `db.rawAll`, `db.prepare`, and a second `db.transaction()` each threw `SQLITE_TRANSACTION | retryable=false | "Use the active Transaction while a transaction is open"` while one transaction was open, and all succeeded again after `tx.rollback()`. t8b.mjs additionally confirmed a statement prepared *before* the transaction also fails during it and works again after. The dead-code claim is confirmed: `transactionId(0)` at :544 runs before the `transaction` operation branch, so `if (transaction !== 0) throw fail("SQLite transaction is already active", ...)` at :576 is unreachable — my second-`transaction()` attempt produced the generic message, never the specific one. What survives as a defect is narrower than 'critical design flaw': (a) the identical situation on a Transaction or Statement handle throws NativeConcurrencyError with `retryable: true` (index.vel:37-42), so the Database-level rejection being `retryable: false` is an internal inconsistency, not a considered choice; (b) the unreachable branch at :576 is confirmed dead; (c) nothing in docs/database-model.md or adapters/sqlite/README.md warns that opening a transaction makes the whole connection unusable.

**建议方向** Queue rather than reject: hold non-transaction messages on `tail` until the transaction settles (the worker is already single-threaded, so serializing is free and matches the documented "serializes connection work"). If rejection is kept, mark it `retryable: true` and give the second-`transaction()` case its own error so callers can back off, and document loudly that a shared `Database` must not be used concurrently with `transaction()`.

---

## 6. [medium/design] Portable migrations cannot add a required column to a populated table — the migration passes in CI and hard-fails in production

**原始位置** `adapters/sqlite/src/index.vel:353-356 (addField → ALTER TABLE ADD COLUMN), :318-331 (columnSql); libraries/database/src/index.vel:465-468 (addFieldStep), :41-47 (step kinds)`

`addFieldStep` accepts any `DatabaseField` with no constraint, and `columnSql` emits `NOT NULL` for a non-nullable field with no default and `UNIQUE` for a unique one. SQLite rejects both forms of `ALTER TABLE … ADD COLUMN`. Worse, the NOT-NULL form is *accepted* when the table is empty and rejected only when it has rows — so a migration passes the developer's fresh database and CI and then aborts on the production database. And because the step vocabulary has no `alterField`/`renameField`/`renameModel`, there is no portable way to change a field's type or nullability at all: `dropField + addField` hits the same wall on any non-empty table.

**Evidence**

```
adapters/sqlite/src/index.vel:355 — `database.exec("ALTER TABLE " + quote(step.modelName, "model name") + " ADD COLUMN " + columnSql(step.fieldName, step.field));`
adapters/sqlite/src/index.vel:324-327 — `if (field.primary) text += " PRIMARY KEY"; if (!field.nullable) text += " NOT NULL"; } if (field.unique && !field.primary) text += " UNIQUE";`
libraries/database/src/index.vel:465-468 — `export def addFieldStep(modelName: string, fieldName: string, field: DatabaseField) -> DatabaseMigrationStep:` — validates only the identifiers.
libraries/database/src/index.vel:41-47 — `enum DatabaseMigrationStepKind: createModel / dropModel / addField / dropField / createIndex / dropIndex` — no field alteration or rename.
```

**Failure scenario**

```
v1 creates `users`. v2 adds `migration(2, [addFieldStep("users", "nickname", column.text())])`. On a developer/CI database (no rows) `migrate` returns `{previousVersion:1, version:2, applied:1}` — green. On production (rows present) the same migration throws `ERR_SQLITE_ERROR: Cannot add a NOT NULL column with default value NULL`, rolls back, and the deploy is stuck with no recovery step in the vocabulary. Separately, `addFieldStep("users","handle", column.text(nullable=true, unique=true))` always throws `Cannot add a UNIQUE column` even on an empty table, though it passes every library assertion.
```

**当时如何验证的** CONFIRMED. t4.mjs, `:memory:`, node v24.15.0. Case A (`addFieldStep("users","nickname", column.text())` on an EMPTY table) returned `{previousVersion:1, version:2, applied:1}` — green. Case A2, byte-identical migration on a table with one row, threw `ERR_SQLITE_ERROR: Cannot add a NOT NULL column with default value NULL`. Case B (`nullable=true, unique=true`) threw `ERR_SQLITE_ERROR: Cannot add a UNIQUE column` even on an empty table, i.e. that step shape can never succeed at all yet passes every library assertion. The data-dependent CI-green/prod-red asymmetry is therefore real and reproduced. The code is as quoted: `applyStep` emits a raw `ALTER TABLE ... ADD COLUMN columnSql(...)` (:353-356) with no pre-flight check, `columnSql` appends `NOT NULL` for `!field.nullable` and `UNIQUE` for `field.unique && !field.primary` (:318-331), `addFieldStep` validates only the two identifiers (libraries/database/src/index.vel:465-468), and `DatabaseMigrationStepKind` has exactly six members with no field alteration or rename (libraries/database/src/index.vel:41-47). Not covered by any decision: D87 rules out automatic schema *diffing*, which is about generating steps, not about validating a hand-written one.

**建议方向** (1) Make `addFieldStep` reject `unique=true` and reject `nullable=false` with `defaultValue == null` at construction, pointing the caller at `createIndexStep(unique=true)` and at a default value. (2) Add the missing step kinds — `alterField` (type/nullability) and `renameModel`/`renameField` — and implement `alterField` in SQLite as the standard create-new-table / copy / drop / rename rebuild inside the existing migration transaction. Without them the portable migration vocabulary cannot express the most common real-world migration.

---

## 7. [medium/design] `retryable` is always false for real SQLite failures and `sqliteCode` is always "ERR_SQLITE_ERROR" — applications cannot classify errors

**原始位置** `adapters/sqlite/src/index.vel:605-611 (errorData), :646-648 (errorFrom), :959-967 (sqliteFailure); libraries/database/src/index.vel:161-170 (DatabaseError)`

`errorData` reads `error.retryable` and `error.code` off the thrown object. Only the adapter's own `fail()` objects carry `retryable`; every error raised by `node:sqlite` carries neither, and its `code` is the generic `"ERR_SQLITE_ERROR"` for *all* SQLite failures. The real result code lives on `error.errcode`/`error.errstr`, which the adapter discards. So `SQLITE_BUSY` — the canonical retryable condition — surfaces as `retryable: false`, and a UNIQUE-constraint violation is indistinguishable from a lock timeout, a disk-full, or a corrupt file.

**Evidence**

```
adapters/sqlite/src/index.vel:605-611 —
```
function errorData(error) {
  return {
    message: ...,
    code: error && typeof error.code === "string" ? error.code : null,
    operation: ...,
    retryable: error && error.retryable === true,
  };
}
```
libraries/database/src/index.vel:161-170 — `export class DatabaseError extends Error: const databaseCode: string; const operation: string; const retryable: bool`
docs/database-model.md table: application owns "consistency and retry policy" — the flag it must key off is wrong.
```

**Failure scenario**

```
Two processes open the same database file. Process A holds a write transaction; process B calls `database.transaction()` (or `migrate`). B gets `SqliteError("database is locked", sqliteCode="ERR_SQLITE_ERROR", retryable=false)`. A framework retry helper keyed on `error.retryable` gives up immediately on a condition that would succeed 10 ms later. Symmetrically, a handler that wants to convert a duplicate-email insert into a 409 must string-match `"UNIQUE constraint failed"` because `sqliteCode` is the same for every failure.
```

**当时如何验证的** CONFIRMED, and stronger than claimed. Two-process test against a shared file with `busyTimeout: 0`: the second writer's `transaction()` threw `NativeSqliteError sqliteCode= ERR_SQLITE_ERROR retryable= false | database is locked` — the canonical retryable condition reported as non-retryable and indistinguishable from any other failure. Separately confirmed node:sqlite carries the real code the adapter discards: a UNIQUE violation gives `{code: 'ERR_SQLITE_ERROR', errcode: 2067, errstr: 'constraint failed', retryable: undefined}`. `errorData` (:605-611) reads only `error.code` and `error.retryable`, never `errcode`/`errstr`. Strengthening the finding: I grepped every `fail(...)` call site in the worker and NOT ONE passes `retryable=true` (the parameter defaults to false at :59), so every worker-originated error is `retryable: false` — only the two main-thread classes NativeBackpressureError and NativeConcurrencyError ever set it true. docs/database-model.md assigns "consistency and retry policy" to the application and D87 requires adapters to "公开真实能力", so exposing a `retryable` flag that is structurally always false for driver errors is a real contract gap. No test pins these semantics.

**建议方向** In `errorData`, prefer `error.errstr`/`error.errcode` over `error.code`, map the primary result code to a stable `sqliteCode` (`SQLITE_BUSY`, `SQLITE_LOCKED`, `SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_FULL`, …), and set `retryable: true` for BUSY/LOCKED/PROTOCOL/INTERRUPT. Consider adding a portable `DatabaseErrorKind` (conflict / contention / capacity / integrity / unavailable) to `@velarscript/database` so applications can classify without engine knowledge.

---

## 8. [medium/ambiguity] `contains`/`startsWith`/`endsWith` have unspecified case semantics and are accepted on non-text fields, silently matching the storage encoding

**原始位置** `adapters/sqlite/src/index.vel:213-217 (LIKE compilation), :183-186 (escapeLike); libraries/database/src/index.vel:298-306 (contains/startsWith/endsWith)`

The metacharacter escaping is correct (I verified `%` and `_` are matched literally via `ESCAPE '\'`), but two semantics are undefined. (1) The adapter emits bare `LIKE`, which in SQLite is ASCII-case-*insensitive*; PostgreSQL's `LIKE` is case-sensitive. The same portable filter therefore returns different rows on different adapters, and neither docs/database-model.md nor the library documents which is intended. (2) `compileFilter` fetches the field but never checks `field.kind`, so `contains` on an integer/boolean/json/bytes column compiles to a LIKE against SQLite's storage encoding and silently returns nonsense.

**Evidence**

```
adapters/sqlite/src/index.vel:213-217 —
```
if (["contains", "startsWith", "endsWith"].includes(kind)) {
  const escaped = escapeLike(value);
  output.push(kind === "contains" ? "%" + escaped + "%" : kind === "startsWith" ? escaped + "%" : "%" + escaped);
  return column + " LIKE ? ESCAPE '\\'";
}
```
(`const field = fieldOf(model, name)` at :199 is fetched but its `kind` is never consulted on this path.)
libraries/database/src/index.vel:298-300 — `def containsFilter<T>(model: DatabaseModel<T>, field: string, value: string) -> DatabaseFilter: return leafFilter(model, DatabaseFilterKind.contains, field, value)`
docs/database-model.md defines the portable field kinds but says nothing about LIKE case folding.
```

**Failure scenario**

```
An app implements "search users by email fragment" as `filter.contains(users, "email", query)`. On SQLite, searching `"alice"` also returns `"Alice@X.com"` (ASCII folding only — `é` vs `É` still will not match, so the behavior is inconsistent even within one engine). Port the same app to a PostgreSQL adapter and the row disappears. Separately, `filter.contains(users, "enabled", "1")` type-checks (the field name is a plain string, the value is a string) and returns *every* row, because booleans are stored as `1`/`0` — I measured all 5 rows returned.
```

**当时如何验证的** CONFIRMED, both halves, in t5.mjs. Case folding: `contains 'alice'` returned `['Alice@X.com', 'alice@x.com']` — SQLite's bare `LIKE` is ASCII-case-insensitive, and nothing in docs/database-model.md, docs/language-charter.md, or docs/decisions/ specifies the intended portable semantics; a PostgreSQL adapter's `LIKE` would return only the lowercase row. Non-text fields: `filter.contains(users, "id", "1")` (integer field) returned the id=1 row and `filter.contains(users, "enabled", "1")` (boolean field) returned ALL FIVE rows, matching SQLite's `1`/`0` storage encoding. Root cause verified: on the LIKE path in `compileFilter` (:213-217) the value goes to `escapeLike` and is pushed straight to `output`, entirely bypassing `encodeValue(field, value)` — the `field` fetched at :199 is never consulted, so the boolean/integer type check that every other operator performs simply does not run. I also independently confirmed the finder's honest negative result that the metacharacter escaping is CORRECT: `contains '%'` returned only `bob%admin` and `contains '_'` only `carol_1`, so `ESCAPE '\'` works and there is no injection here. tests/fixtures/database-adapters/main.vel never exercises these three filters at all.

**建议方向** Specify the case semantics in docs/database-model.md and enforce them — either declare `contains` case-sensitive and emit `GLOB`/`LIKE … COLLATE BINARY` in SQLite, or add an explicit `caseInsensitive: bool` parameter to the three constructors and let each adapter implement both. Independently, reject `contains`/`startsWith`/`endsWith` on any field whose `kind != text` in `leafFilter` (the model definition is in hand there) and again in `compileFilter`. The same root cause — the query surface being `field: string` / `value: unknown` / `changes: Record<unknown>` (libraries/database/src/index.vel:271, :367, :415) — means field-name typos and type mismatches are all runtime errors in a language whose selling point is compile-time ownership; a `Type<T>`-driven field accessor would close the whole class.

---

## 9. [medium/design] No 64-bit integer field kind and no opt-in: one out-of-range value makes an entire query fail on any pre-existing SQLite file

**原始位置** `libraries/database/src/index.vel:5-11 (DatabaseFieldKind); adapters/sqlite/src/index.vel:169 (integer decode guard), :521-525 (normalize bigint branch)`

`DatabaseFieldKind` offers only `integer`, which the adapter binds to JS `number`, and the adapter never calls `setReadBigInts`. `node:sqlite` throws `ERR_OUT_OF_RANGE` while *reading* any INTEGER column value outside the safe-integer range, so the adapter's own guards at :169 and :521-525 never get a chance to run — the driver aborts first, and the failure takes down the whole row set, not the offending value. Any existing SQLite file holding snowflake ids, microsecond timestamps, or bigints written by another application is simply unreadable through this adapter, including via `rawAll`.

**Evidence**

```
libraries/database/src/index.vel:5-11 — `export enum DatabaseFieldKind: text / integer / real / boolean / bytes / json` (no `bigint`)
adapters/sqlite/src/index.vel:169 — `if (field.kind === "integer" && !Number.isSafeInteger(value)) throw fail("SQLite returned an unsafe integer", "SQLITE_RESULT", "decode");`
adapters/sqlite/src/index.vel:521-525 — `if (typeof value === "bigint") { const number = Number(value); if (!Number.isSafeInteger(number)) throw fail("SQLite returned an integer outside VelarScript's safe range", ...) }` — unreachable in the default read mode, since `setReadBigInts` is never enabled.
```

**Failure scenario**

```
`open("./existing.db")` over a database written by another tool whose `events` table has an `id INTEGER` holding `9007199254740993`. `database.find(select(events, limit=100))` throws `NativeSqliteError: Value is too large to be represented as a JavaScript number: 9007199254740993` with `sqliteCode: ERR_OUT_OF_RANGE` — and it fails the whole 100-row page, so there is no way to read the other 99 rows or even to discover which column is at fault. `SqliteOptions` (adapters/sqlite/src/index.vel:4-12) offers no escape.
```

**当时如何验证的** CONFIRMED. t10.mjs: inserted `9007199254740993` and `4611686018427387904` into an INTEGER column via `rawExecute`, then both `rawAll("SELECT id, n FROM big")` and a portable `executeQuery` over a declared model threw `NativeSqliteError: Value is too large to be represented as a JavaScript number: 9007199254740993` with `sqliteCode: 'ERR_OUT_OF_RANGE'`. The driver aborts during row iteration, so the adapter's own guards never run: the message at :169 ("SQLite returned an unsafe integer") and the bigint branch at :521-525 ("outside VelarScript's safe range") are both dead in the default read mode because `setReadBigInts` is never enabled anywhere in the file. The failure takes the whole result page, not the offending value, so there is no way to read the other rows or identify the bad column. `DatabaseFieldKind` (libraries/database/src/index.vel:5-11) has no bigint member and `SqliteOptions` (:4-12) offers no escape. docs/database-model.md lists the portable kinds without any note that INTEGER is restricted to 2^53.

**建议方向** Either add a portable `bigint` field kind backed by the language's arbitrary/64-bit integer representation, or (minimum) add a `bigIntText`/`readBigInts` option that calls `setReadBigInts(true)` and lets `decodeValue` surface out-of-range values as text or a typed error naming the column — so one bad value degrades one field, not the whole query. Document the 2^53 limit on `DatabaseFieldKind.integer` in docs/database-model.md either way.

---

## 10. [low/design] `DatabaseSchema.models` is a required argument that no adapter ever reads — migrate() never verifies the database matches the declared models

**原始位置** `libraries/database/src/index.vel:140-144, :442-455 (databaseSchema); adapters/sqlite/src/index.vel:385-405 (migrate)`

`databaseSchema(name, version, models, migrations)` forces callers to pass and maintain a `models` list, and `DatabaseSchema` carries it across the Worker boundary — but `migrate()` reads only `schema.name`, `schema.version` and `schema.migrations`. Nothing checks that applying the migrations actually produces the declared models. The field is decorative, and its presence in the signature and in the docs' example implies a reconciliation that does not exist.

**Evidence**

```
libraries/database/src/index.vel:442-455 — `export def databaseSchema(name, version, models, migrations)` … `return {name, version, models: models.copy(), migrations: migrations.copy()}` — validates only duplicate model names.
adapters/sqlite/src/index.vel:385-389 —
```
function migrate(schema) {
  ownRecord(schema, "schema", 4);
  identifier(schema.name, "schema name");
  integer(schema.version, 0, 1000000, "schema version");
  if (!Array.isArray(schema.migrations) || schema.migrations.length !== schema.version) throw fail(...)
```
`schema.models` appears nowhere else in adapters/sqlite/src/index.vel.
```

**Failure scenario**

```
A developer adds a `posts` model to `schema`'s `models` list but forgets the matching `createModelStep` in `migration(2, …)` (or bumps the version and edits the wrong migration). `await database.migrate(schema)` returns `{previousVersion:0, version:1, applied:1}` — success. The mismatch only surfaces later as `ERR_SQLITE_ERROR: no such table: posts` on the first query, in production, at request time. I also confirmed `migrate` accepts `models: []` outright.
```

**当时如何验证的** CONFIRMED. `grep -n '\.models' adapters/sqlite/src/index.vel` at HEAD returns ZERO hits — `schema.models` is genuinely never read by the adapter. `migrate` (:385-405) reads only `schema.name`, `schema.version`, and `schema.migrations`. t4.mjs case C: `migrate` with `models:[users, posts]` but only `createModelStep(users)` returned `{previousVersion:0, version:1, applied:1}` (success), and the subsequent query threw `ERR_SQLITE_ERROR: no such table: posts`. Case D: `models: []` with a real migration also returned success. `databaseSchema` (libraries/database/src/index.vel:442-455) only checks duplicate model names and `migrations.size == version`. The 'no auto schema diff' rulings in D87 and docs/database-model.md forbid *generating* steps, not *verifying* the resulting schema, so nothing blesses ignoring the field.

**建议方向** Add a non-destructive post-migration verification: after the last step, read `PRAGMA table_info` for each declared model and fail the (still open) migration transaction if a table or column is missing or has the wrong storage class / nullability. That is a read-only check, generates no steps, and turns a production-time "no such table" into a deploy-time error. If verification is unwanted, remove `models` from `DatabaseSchema` so it stops implying a guarantee.

---

## 11. [low/consistency] The contract's declared bounds exceed every adapter bound, so plans that pass all `select()`/`filter` assertions are rejected at execution

**原始位置** `libraries/database/src/index.vel:196-200 (requireLimit), :273 (leafFilter values ≤ 10000), :358; adapters/sqlite/src/index.vel:242-246, :206`

`select()` validates `limit` against 1,000,000 and `filter.oneOf` against 10,000 values, but the SQLite adapter caps a non-streaming limit at `maxRows` (default 10,000) and `oneOf` at `maxParameters` (999). A plan that satisfies every assertion in the portable contract is therefore rejected with a `SQLITE_INPUT` error at execution time. `DatabaseCapabilities` reports `maxParameters` but has no `maxRows`, so `oneOf` is at least discoverable while `limit` is not discoverable at all.

**Evidence**

```
libraries/database/src/index.vel:358 — `const checkedLimit = requireLimit(limit, "Database query limit", 1000000)`
libraries/database/src/index.vel:273 — `assert values.size <= 10000 else "A database filter cannot contain more than 10000 values"`
adapters/sqlite/src/index.vel:244 — `const maximum = streaming ? 1000000 : workerData.maxRows;`
adapters/sqlite/src/index.vel:206 — `filter.values.length > workerData.maxParameters` → `"oneOf filter exceeds the SQLite parameter limit"`
libraries/database/src/index.vel:152-159 — `DatabaseCapabilities` lists `maxParameters` but no row/limit bound.
```

**Failure scenario**

```
An export endpoint writes `select(users, limit=50000)`. It compiles, passes `requireLimit`, and throws at runtime: `SQLITE_INPUT: query limit must be an integer from 0 through 10000`. Likewise `filter.oneOf(users, "id", ids)` with 1,500 ids passes `leafFilter`'s 10,000 check and throws `oneOf filter exceeds the SQLite parameter limit`. Neither ceiling is visible to portable code: `capabilities` cannot report the row limit, so the application cannot chunk defensively.
```

**当时如何验证的** Behavior CONFIRMED, but half the claim is refuted. t5.mjs with default options: `limit 50000 THREW: SQLITE_INPUT query limit must be an integer from 0 through 10000` and `oneOf 1500 THREW: SQLITE_INPUT oneOf filter exceeds the SQLite parameter limit`, both after passing every library-side assertion. `DatabaseCapabilities` (libraries/database/src/index.vel:152-159) does list `maxParameters` and does not list any row/limit bound — confirmed. The `oneOf` half stands unconditionally: `maxParameters` is HARDCODED to 999 in `checkedOptions` (:656) with no option to raise it, while `leafFilter` permits 10,000 values, so that library ceiling is genuinely unreachable on this adapter.

**建议方向** Add `maxRows` (and ideally `maxValuesPerFilter`) to `DatabaseCapabilities` so `requireLimit`'s ceiling becomes discoverable, and lower the library's own constants to advertised portable minima rather than numbers no adapter supports. Alternatively have `oneOf` split into chunked `any(...)` groups automatically when it exceeds `capabilities.maxParameters`.

---

## 12. [low/performance] Prepared statements accumulate without bound in the Worker, and a database-level statement is unusable inside a transaction

**原始位置** `adapters/sqlite/src/index.vel:563-567 (prepare), :571-574 (statement.close), :435 (statement ownership check)`

The worker's `statements` Map grows on every `prepare` with no cap — unlike `cache`, which is bounded by `statementCacheCapacity`. A handler that prepares a statement and does not close it (no `using`, or an exception before `close()`) leaks a live `StatementSync` plus a main-thread `state.resources` entry for the life of the connection. Compounding this, a statement prepared on the `Database` is stamped `transaction: 0` and `statement()` rejects it whenever a transaction is open, so the intended "prepare once, reuse many times" pattern cannot survive any transaction on the connection — pushing users toward preparing per-call, which is exactly the leak path.

**Evidence**

```
adapters/sqlite/src/index.vel:563-567 —
```
if (message.operation === "prepare") {
  const id = nextStatement++;
  statements.set(id, { statement: database.prepare(sql(message.sql)), transaction: tx });
  return id;
}
```
adapters/sqlite/src/index.vel:434-437 — `function statement(id, transactionId) { const item = statements.get(id); ... if (item.transaction !== transactionId) throw fail("SQLite statement belongs to another transaction", ...) }`
Compare the bounded cache at :448-457 — `if (cache.size > workerData.statementCacheCapacity) cache.delete(cache.keys().next().value);`
docs/database-model.md, adapter requirements: "document and enforce queue, parameter, row, per-row, total-result, stream, cache, and connection/pool bounds" — live statements are not on the list and are not bounded.
```

**Failure scenario**

```
A request handler does `const st = await database.prepare("SELECT ...")` and returns early on a validation failure before `st.close()` (or simply relies on GC). Each request permanently adds one `StatementSync` to the worker. I prepared 20,000 statements with no close and saw no error and +61.3 MB RSS; `queueCapacity` (default 256) bounds only in-flight *requests*, not live statements, so nothing ever pushes back. Separately, `const st = await db.prepare(sql)` followed by any `db.transaction()` makes `st.execute()` throw `SQLITE_TRANSACTION` — verified in t1.mjs where even `db.prepare` itself throws while a transaction is open.
```

**当时如何验证的** CONFIRMED. t8.mjs: 20,000 `db.prepare(...)` calls with no `close()` raised no error and added 56.8 MB main-thread RSS; the worker's `statements` Map (:563-567) has no cap, in visible contrast to `cache`, which evicts at `workerData.statementCacheCapacity` (:434). `makeStatement` also adds an entry to `state.resources` that is only removed on close. `queueCapacity` bounds in-flight requests, not live statements, so nothing pushes back. The second half is confirmed by t8b.mjs: a statement prepared on the Database before a transaction works (`[{"a":1}]`), throws `SQLITE_TRANSACTION | retryable=false` during the transaction, and works again after rollback. I also confirmed the leak is reachable in ordinary VelarScript: `using` is NOT compiler-enforced — I compiled a class with an `@dispose:` block bound via plain `const` through packages/compiler/dist/index.js and got zero diagnostics, and docs/language-charter.md §ownership describes `using` as an opt-in ownership form, not a mandatory one.

**建议方向** Add a `maxStatements` option (mirroring `statementCacheCapacity`) and reject `prepare` with a `SQLITE_RESOURCE_LIMIT` error once exceeded, so a leak fails fast instead of growing silently. Also allow a `transaction: 0` statement to execute inside a transaction (a prepared statement is not transaction-scoped in SQLite) or, if the restriction is intentional, say so in the README and give `Database.prepare` a distinct error message rather than the generic transaction rejection.

---

## 附：一条跨仓库的残留

「四种不兼容的行模型」这一条同时横跨两个仓库，`VelarScript-Libraries` 只能做它那一半。

- **已在那边完成**：`packages/text-buffer/README.md` 写明 `lineCount` 只按 `\n` 计数，
  与编译器的行模型不一致。
- **留在本仓**：真正的统一。`Text.lineStarts` 是 Core 标准 API，只认 `\n`；
  `packages/compiler/src/source.ts` 的 `lineStarts` 构造、`Text.lines`、以及
  script-analysis 各自另有一套。Libraries 那边按其 AGENTS.md **不拥有语言与标准 API**，
  所以正确的做法是在本仓把其中一种定为规范（例如让 `\r\n | \r | \n` 成为可选项或
  第二个入口），而不是在库里再实现第五种切分——那只会让问题更糟。

这条本身是 low 级，但它是一个典型形状：**同一个概念在四处各自实现**，
迟早会在某个边界上对不齐。
