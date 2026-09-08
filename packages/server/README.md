# @velarscript/server

**VelarScript 0.32.0 · Server surface `server@0.15`.** A Server project's
`velar.json` declares `{"core": "0.9", "server": "0.15"}` in `surfaces` — one
entry per *activated* extension, so composing Node does not add a third — and a
declaration that no longer matches what is installed is refused by name. This
package's own manifest pins the surface it composes
(`"@velarscript/node": "0.17"`).

The official convention-based VelarScript server application framework. It is
activated explicitly in `velar.json`, composes `@velarscript/node`, and owns
the explicit `server.configuration` path, application startup assembly, typed
application-scoped connection lifecycle, and a target-specific realtime
session module.

The realtime boundary has two deliberate layers:

- `velar/websocket` owns HTTP upgrade, frames, Origin admission, close codes,
  transport limits, and the physical connection.
- server-target `velar/realtime.realtimeSession` owns the repeatable application session:
  decode, sequential command handling, one bounded outbound mailbox, one
  writer, failure policy, cleanup, and close notification.

Applications still own authentication, rooms, subscriptions, command/event
types, serialization, authorization, and delivery guarantees. A shared
protocol package can therefore be consumed by both server and browser without
making the server framework depend on one client or one wire format.

```velar fragment
import {Bytes} from "velar/binary"
import {RealtimeFailureAction, RealtimePeer, realtimeSession} from "velar/realtime"
import {WebSocketConnection} from "velar/websocket"

type Command:
    operation: string

type ServerEvent:
    event: string

def decode(message: string | Bytes) -> Command:
    if message is string: return Json.parse(message, Command)
    throw Error("Binary commands are not supported")

def encode(event: ServerEvent) -> string | Bytes: return Json.stringify(event)

async def receive(command: Command, peer: RealtimePeer<ServerEvent>): await peer.send({event: command.operation})

async def session(connection: WebSocketConnection):
    await realtimeSession(
        connection,
        {decode, encode},
        receive,
        failed=async (_failure, _peer) => RealtimeFailureAction.close,
    )
```

`send` waits until that message reaches the transport. `trySend` never waits
and returns `false` when the session mailbox is full. Inbound commands are
handled in wire order. The framework deliberately does not replay commands or
claim stronger-than-WebSocket delivery; sequence numbers, acknowledgements,
resume cursors, and idempotency keys belong to the shared application protocol.

`authenticate(credential, verify)` turns one checked `security` descriptor into
a request-scoped `Provider<Identity>`. The verifier must resolve to a typed
optional identity: `null` rejects the credential with the descriptor's opaque
401 challenge, while a value is cached for the request and may be injected with
`input.dependency`. Verification failures that are not credential rejection
remain server failures rather than being mislabeled as 401 responses.

The framework owns this composition boundary, not an identity model. JWT/JWK,
OIDC, password hashing, signed sessions, and provider integrations remain
installed libraries. User records, tenants, roles, permissions, revocation, and
session persistence remain application policy.

An application's own refusals travel as `HttpProblem`, whose semantic code is
`.reason`; `.code` is the Error contract's class name on every error, as the
charter requires, and the wire problem document keeps its JSON field `code`.
Every route outcome — a thrown `HttpProblem`, an unexpected error's opaque 500,
the framework's own 404 — leaves through the application's middleware, so
security, CORS and request-id headers reach error responses too.

Concrete database drivers, models, migrations, and queries remain ordinary
application dependencies.
