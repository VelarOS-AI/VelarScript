# The VelarScript Server AI skill brief

Load this after `velar skill core` and `velar skill node`. This brief contains
only the convention-based Server application framework. Node still owns route
syntax, HTTP/WebSocket transport, filesystem, process, and the low-level
`velar/serve` runtime.

## Activation and ownership

A service installs and explicitly activates `@velarscript/server`, just as a
browser application activates `@velarscript/web`:

```json
{
  "dependencies": {
    "@velarscript/server": "0.14.2"
  }
}
```

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "extensions": ["@velarscript/server"]
}
```

The Server application extension composes the Node capability. Do not list both
extensions. Without `@velarscript/server`, `velar/server` is unavailable and
root application configuration is not loaded.

The conventional entry export is `start`. A different exported binding may be
selected with the optional `server.app` manifest field; `server.build.sourceMaps`
is the only build setting. Host, port, request limits, database locations, and
other runtime settings never belong in `velar.json`.

## Convention-based application configuration

The only conventional configuration file is root `application.yml`.

YAML and JSON enter the same checked runtime-Type boundary. Files are bounded;
YAML is strict, rejects duplicate keys, and limits aliases. An explicit
`.yml`, `.yaml`, or `.json` path is the escape hatch for deployment-specific
configuration; other root filenames are never discovered by convention.

The framework-owned server section is:

```yaml
server:
  host: 127.0.0.1
  port: 3000
  maxBodyBytes: 16777216
```

All three fields are optional. Their defaults are `127.0.0.1`, `3000`, and
16 MiB. `application(app)` reads this section when the server starts:

```velar
import {application} from "velar/server"

export server routes:
    @get(p"/health") => {status: "ready"}

export const start = application(routes)
```

`velar dev`, `velar serve`, and the standalone `velar build` output use the
same root configuration. CLI `--host` and Node `--port` overrides are not a
second configuration channel. A missing conventional file uses the server
defaults; when application-specific settings are required, load the full file
with `configuration(Type)`, which requires the file to exist.

## Typed application settings

Declare the application-owned shape and load it through its Runtime Type:

```velar
import {configuration} from "velar/server"

type ServerSettings:
    host: string
    port: number
    maxBodyBytes: number

type DatabaseSettings:
    path: string
    busyTimeoutMilliseconds: number

type ApplicationSettings:
    server: ServerSettings
    database: DatabaseSettings

export const settings = await configuration(ApplicationSettings)
```

`configuration(Type, path=null, maxBytes=65536)` returns
`Promise<Type>`. A non-null path must end in `.yml`, `.yaml`, or `.json`.
The framework parses syntax; the application Runtime Type owns field names and
types, and application validation still owns domain ranges and invariants.
Environment variables may form an explicit deployment override layer, but
secrets do not belong in application configuration.

## Abstract database connection lifecycle

`database(connect, disconnect)` creates an eager application-scoped
`Provider<Connection>`. It establishes one typed connection during application
startup, injects that same value into routes, and disconnects it during
application shutdown after admitted work has drained:

```velar
import {database} from "velar/server"
import {input} from "velar/serve"

type Connection:
    name: string
    close: () -> Promise<null>

const connection = database(
    connect=async () => {name: "primary", close: async () => null},
    disconnect=async value => await value.close(),
)

export server databaseRoutes:
    @get(p"/database", value=input.dependency(connection)) => {name: value.name}
```

The framework owns only this connect/inject/disconnect lifecycle. Concrete
drivers, pools, database models, schemas, queries, migrations, transactions,
dialect behavior, retry rules, and credentials remain independently installed
application dependencies. Do not add SQLite, PostgreSQL, an ORM, or model
syntax to `@velarscript/server` or `@velarscript/node`.

## Custom shared HTTP/WebSocket startup

A service that needs one custom shared HTTP/WebSocket listener may load the same
typed configuration and export an exact zero-argument async startup function:

```velar fragment
import {configuration} from "velar/server"
import {listen} from "velar/websocket"

type ServerSettings:
    host: string
    port: number
    maxBodyBytes: number

type Settings:
    server: ServerSettings

const settings = await configuration(Settings)

export async def start():
    return await listen({
        host: settings.server.host,
        port: settings.server.port,
        http: routes,
        path: "/events",
        origins: ["https://app.example.com"],
        maxBodyBytes: settings.server.maxBodyBytes,
    })
```

The result must be exactly `Promise<WebSocketServer>`. The launcher supplies no
host, port, or body-limit arguments; the root application configuration remains
the single runtime authority.

Use direct `serve(app, port=0)` in tests or embedded low-level adapters. Use
`velar/server-test` only from `*.test.vel`. Route, provider, transport,
Origin-admission, resource-limit, and shutdown semantics are documented in the
Node brief because Node owns those primitives.
