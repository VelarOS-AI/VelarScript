# @velarscript/database

The engine-neutral VelarScript database contract. It defines immutable model
descriptors, parameterized query plans, explicit migrations, bounded result
APIs, transaction ownership, capability reporting, and common errors.

It contains no SQL dialect, driver, connection pool, Node API, or compiler
syntax. Install a separate adapter such as `@velarscript/sqlite` to execute the
contract.

```velar
import {column, filter, model, select} from "@velarscript/database"

type User:
    id: string
    email: string

const users = model("users", User, {
    id: column.text(primary=true),
    email: column.text(unique=true),
})

const byId = select(users, where=filter.equal(users, "id", "u-1"), limit=1)
```

The package is independently versioned and is not part of the VelarScript
toolchain release set or the `velar/*` Standard namespace.
