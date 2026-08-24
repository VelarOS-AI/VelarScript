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
    "@velarscript/server": "0.14.4"
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

## Request authentication

Node's `security` values own credential extraction, malformed-input rejection,
401 challenges, and OpenAPI descriptions. Server's `authenticate` composes one
of those descriptors with an application- or package-provided verifier:

```velar
import {authenticate} from "velar/server"
import {input, security} from "velar/serve"

type Principal:
    subject: string

const exampleTokens: Map<string, Principal> = Map([
    ["example-test-token", {subject: "user-1"}],
])

async def verifyAccessToken(token: string) -> Principal?:
    // A deployed application replaces this test map with an installed verifier.
    return exampleTokens.get(token)

const currentPrincipal = authenticate(security.bearer(), verifyAccessToken)

export server accountRoutes:
    @get(p"/me", principal=input.dependency(currentPrincipal)) => {
        subject: principal.subject,
    }
```

`authenticate(credential, verify)` accepts only a `security.apiKey`, `basic`,
`bearer`, `oauth2`, or `openId` descriptor. `verify` must return
`Promise<Identity?>`. It resolves once per request: `null` becomes the same
opaque `not_authenticated` 401 response and `WWW-Authenticate` challenge as a
missing credential, while a non-null value becomes the typed request Provider
result. A thrown verifier failure remains an opaque 500 because a key-service,
database, or network failure is not proof of an invalid credential.

The verified identity shape belongs to the application. JWT/JWK and OIDC
verification, password hashing, signed sessions, and vendor integrations are
explicit installed packages; user storage, tenant membership, roles,
permissions, revocation, and resource-level authorization remain application
policy. Do not place secrets in `application.yml`, invent a universal `User`
record, or turn authentication into new route syntax or `@` roles.

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
