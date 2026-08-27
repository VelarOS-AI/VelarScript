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
    "@velarscript/server": "0.20.0"
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
selected with the optional `server.app` manifest field. Source maps belong to
the target-neutral top-level `build.sourceMaps` switch. Host, port, request limits, database locations, and
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

## Typed realtime sessions

Keep the physical socket and the application session separate. A declarative
`@websocket` route receives `WebSocketConnection`; pass it to
`realtimeSession` with the codec from the application's shared protocol
package:

```velar fragment
import {Bytes} from "velar/binary"
import {RealtimeFailure, RealtimeFailureAction, RealtimePeer, realtimeSession} from "velar/realtime"
import {WebSocketConnection} from "velar/websocket"

type Command:
    operation: string

type ServerEvent:
    event: string

def decode(message: string | Bytes) -> Command:
    if message is string: return Json.parse(message, Command)
    throw Error("Binary commands are not supported")

def encode(event: ServerEvent) -> string | Bytes:
    return Json.stringify(event)

async def receive(command: Command, peer: RealtimePeer<ServerEvent>):
    await peer.send({event: command.operation})

async def failed(failure: RealtimeFailure, _peer: RealtimePeer<ServerEvent>):
    print(failure.error)
    return RealtimeFailureAction.close

async def serveSession(connection: WebSocketConnection):
    await realtimeSession(
        connection,
        {decode, encode},
        receive,
        failed=failed,
        options={maxQueuedMessages: 64, maxQueuedBytes: 1_048_576, drainTimeout: 5s},
    )
```

The session runs one sequential inbound handler and one writer over a bounded
outbound mailbox. `peer.send(event)` waits for its own transport send;
`peer.trySend(event)` returns `false` instead of waiting when the mailbox is
full. `opened` may install a subscription and return an async cleanup function;
cleanup runs exactly once before the writer finishes draining. `closed`
receives the actual `WebSocketClose` code and reason.

`RealtimeFailureAction.continue` skips one failed decode or command and keeps
the session alive. Unrecoverable setup, transport, encode, and send failures
close the session. Route authentication, authorization, room membership,
subscription ownership, and application delivery semantics remain application
policy. Do not report a command as durable merely because `send` completed:
WebSocket is ordered but application delivery is still at-most-once unless the
shared protocol adds message IDs, acknowledgements, resume cursors, and
idempotent handling.

## Custom shared HTTP/WebSocket startup

A service whose route table contains `@websocket` declarations may load the
same typed configuration and export an exact zero-argument async startup
function for the shared HTTP/WebSocket listener:

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
        origins: ["https://app.example.com"],
        maxBodyBytes: settings.server.maxBodyBytes,
    })
```

The result must be exactly `Promise<WebSocketServer>`. The launcher supplies no
host, port, or body-limit arguments; the root application configuration remains
the single runtime authority. Each `@websocket` RoutePattern owns its own path,
typed captures, admission inputs, and session handler, so this declarative mode
does not accept the listener's legacy single `path` option.

Use direct `serve(app, port=0)` in tests or embedded low-level adapters. Use
`velar/server-test` only from `*.test.vel`. Route, provider, transport,
Origin-admission, resource-limit, and shutdown semantics are documented in the
Node brief because Node owns those primitives.
