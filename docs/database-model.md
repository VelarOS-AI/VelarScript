# Database Model and Adapter Standard

Status: engine-neutral source-package contract

VelarScript does not make a database engine part of the language or a target.
The common contract is the ordinary source library `@velarscript/database`;
concrete engines are independently installed adapters such as
`@velarscript/sqlite`. The compiler gives neither package special syntax,
resolution, reflection, or runtime privileges.

This boundary keeps four authorities separate:

| Owner | Owns | Must not own |
| --- | --- | --- |
| Core | records, Runtime Types, async ownership, cancellation | models, SQL, drivers, schema discovery |
| `@velarscript/database` | portable model/query/mutation/migration data and adapter SPI | dialects, connections, pools, workers |
| adapter | driver, dialect, isolation, capacity limits, engine escape hatches | compiler syntax or hidden Standard modules |
| application | model definitions, migrations, transactions, consistency and retry policy | ambient native handles |

## Model declarations

A model combines an immutable portable definition with a Runtime Type parser.
Field names and model names are portable ASCII identifiers; the `__velar_`
prefix is reserved for adapter bookkeeping. A model has at most one portable
primary field. Relations are metadata and never trigger hidden loading.

```velar
import {column, index, model, reference} from "@velarscript/database"

type User:
    id: string
    email: string
    enabled: bool

const users = model("users", User, {
    id: column.text(primary=true),
    email: column.text(unique=true),
    enabled: column.boolean(defaultValue=true),
}, indexes=[index("users_email", ["email"], unique=true)])
```

Portable field kinds are `text`, `integer`, `real`, `boolean`, `bytes`, and
`json`. Adapters validate values again at their native boundary. An adapter may
offer engine-specific types in its own API, but cannot silently reinterpret a
portable field.

## Queries and mutations

Queries are immutable data plans. Values remain parameter data; the common
contract contains no query string and no interpolation facility. Filters are
composed explicitly and are checked against their owning model.

<!-- velar-preamble
import {column, model} from "@velarscript/database"
type User:
    id: string
    email: string
    enabled: bool
const users = model("users", User, {
    id: column.text(primary=true),
    email: column.text(),
    enabled: column.boolean(),
})
-->
```velar fragment
import {Database, filter, order, select} from "@velarscript/database"

async def activeUsers(database: Database) -> List<User>:
    return await database.find(select(
        users,
        where=filter.equal(users, "enabled", true),
        orderBy=[order(users, "email")],
        limit=100,
    ))
```

The common mutation surface is `insert`, `update`, and `delete`. Update and
delete require an explicit filter. It intentionally omits joins, eager loading,
implicit identity maps, dirty tracking, lazy proxies, and generated repository
classes. Those policies either hide I/O or differ materially between engines.

Use `stream(query, consume)` when results may be large. The adapter must not
read ahead without a documented bound, and the producer must wait for each
consumer acknowledgement. `find` remains a bounded convenience operation;
applications should set domain limits below an adapter's hard maximum.

## Transactions and ownership

`Database`, `DatabaseTransaction`, and adapter-native prepared statements are
owned resources. Use `using`. Disposing an uncommitted transaction rolls it
back; `close`, `commit`, and `rollback` are idempotent. The contract permits
concurrent calls only when the adapter declares and implements that capability.
It never implies that a read-modify-write application sequence is atomic.

Adapters report `transactions`, `migrations`, `streaming`, `cancellation`,
`concurrentReads`, `returning`, and `maxParameters`. Unsupported behavior must
fail or be reported as unsupported; an adapter cannot emulate it with weaker
semantics without saying so.

## Migrations

Migration history is explicit, contiguous, and application-owned. Version `N`
has exactly the ordered migrations `1..N`. Destructive model and field drops
require `destructive=true` at the declaration site.

<!-- velar-preamble
import {column, model} from "@velarscript/database"
type User:
    id: string
    email: string
    enabled: bool
const users = model("users", User, {
    id: column.text(primary=true),
    email: column.text(),
    enabled: column.boolean(),
})
-->
```velar fragment
import {Database, createModelStep, databaseSchema, migration} from "@velarscript/database"

const schema = databaseSchema(
    "accounts",
    1,
    [users.definition],
    [migration(1, [createModelStep(users)])],
)

async def prepare(database: Database):
    await database.migrate(schema)
```

An adapter records applied version fingerprints and rejects drift, gaps, a
database newer than the application, and unsupported steps. Automatic schema
diffing is not part of the contract: it cannot reliably infer renames or data
transformations and makes destructive behavior too easy to hide.

## Adapter requirements

Every adapter must:

- validate portable plans again before crossing into its driver;
- parameterize values and validate identifiers independently;
- document and enforce queue, parameter, row, per-row, total-result, stream,
  cache, and connection/pool bounds;
- isolate blocking drivers from the application event loop;
- apply backpressure instead of accumulating unbounded work;
- define concurrency and cancellation semantics honestly;
- keep native handles private and settle all queued callers on terminal failure;
- make cleanup deterministic and safe under repeated or concurrent close calls;
- test migration drift, rollback-on-dispose, overload, large results, slow
  consumers, driver failure, and resource release.

The SQLite adapter uses one dedicated Worker per connection because
`node:sqlite` is synchronous. It serializes connection work, reports
`concurrentReads=false` and `cancellation=false`, bounds its statement cache,
and streams rows in acknowledgement-controlled batches. Raw SQL, prepared raw
statements, and SQLite transaction handles exist only in `@velarscript/sqlite`.

## Package and server boundary

Database packages are resolved by npm through normal `velar.entry` source
packages. They are not bundled into the CLI, do not enter a toolchain release,
and cannot claim `velar/database` or `velar/sqlite`.

The Node server framework may accept a `Database` through application-owned
providers, but it has no built-in SQLite integration. This keeps request
routing, dependency lifetime, and application shutdown reusable across SQLite,
PostgreSQL, remote databases, test doubles, and future adapters without making
one engine part of the language.
