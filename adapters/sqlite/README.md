# @velarscript/sqlite

The Node SQLite adapter for `@velarscript/database`. It owns the concrete
`node:sqlite` dependency and keeps all synchronous database work inside one
dedicated Worker per connection.

```velar
import {column, filter, model, select} from "@velarscript/database"
import {open} from "@velarscript/sqlite"

type User:
    id: string
    email: string

const users = model("users", User, {
    id: column.text(primary=true),
    email: column.text(unique=true),
})

async def load(path: string, id: string) -> User?:
    using database = await open(path)
    return await database.findOne(select(users, where=filter.equal(users, "id", id), limit=1))
```

Every connection has a bounded request queue, result-size and row-count limits,
bounded prepared-statement caching, backpressured streaming, deterministic
migrations, explicit transaction ownership, and idempotent cleanup. Raw SQL is
available only from this adapter and never enters the engine-neutral contract.

This package is independently versioned and is not a `velar/*` Standard module.
