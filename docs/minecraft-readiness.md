# Minecraft Readiness

This milestone makes one binary world core usable without project-local unsafe
JavaScript in a Node server and a browser Worker. The contract is intentionally
broader than a game API: it supplies strict binary memory, deterministic
computation, owned concurrent work, bounded transports, and binary persistence.

## Hot loops and packed blocks

A direct `for index in range(...):` is a compiler-recognized counter loop. Its
arguments are evaluated once and receive the same integer, direction, step,
finite-progress, and one-million-iteration checks as `range(...)`; it simply
does not allocate and validate an intermediate List. Using `range` anywhere
else still produces the public `List<number>` value.

`Bytes` is a read-only snapshot for protocols and persistence.
`UInt16Buffer` is fixed-size mutable Chunk memory. Both have strict integer and
index bounds, and their `[]` operations use compiler-specialized lowering.

```velar fragment
import {ByteOrder, Bytes, uint16Buffer} from "velar/binary"

def emptyChunk() -> Bytes:
    const blocks = uint16Buffer(16 ** 3)
    for index in range(blocks.size):
        const light = (index >> 8) & 0x0f
        blocks[index] = (light << 12) | 0x003
    return blocks.toBytes(ByteOrder.little)
```

Radix integer literals and bitwise operators are checked rather than coerced.
Data operands must be 32-bit integers and shift counts must be within `0..31`.

## Reproducible generation

Use `velar/random` and `velar/noise`, never host `Math.random()`, for world
state. String and safe-integer seeds produce the same stream in Node and every
supported browser. `fork(label)` derives a stream that is independent of the
parent's consumption order, which makes Chunk scheduling irrelevant to output.

Long-running generators accept `Cancellation` and place explicit checkpoints
at a useful granularity. A timeout on a Task or Worker call cancels the owned
work instead of merely abandoning an outer Promise.

```velar fragment
import {ByteOrder, Bytes, uint16Buffer} from "velar/binary"
import {random} from "velar/random"
import {Cancellation} from "velar/task"

type ChunkRequest:
    seed: string
    chunkX: number
    chunkZ: number

async def generate(request: ChunkRequest, cancellation: Cancellation) -> Bytes:
    const stream = random(request.seed).fork(f"{request.chunkX}:{request.chunkZ}")
    const blocks = uint16Buffer(16 ** 3)
    for index in range(blocks.size):
        if (index & 0x7f) == 0:
            await cancellation.checkpoint()
        blocks[index] = stream.bool(0.5) ? 1 : 0
    return blocks.toBytes(ByteOrder.little)
```

The complete runnable shared-core example is the repository's
`tests/fixtures/minecraft-readiness` project. It is the acceptance contract, not
sample-only pseudocode.

## Worker ownership

Declare Worker source entries in `velar.json`; do not construct host URLs:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "workers": {"terrain": "src/terrain-worker.vel"}
}
```

The entry serves one checked request/response protocol:

<!-- velar-preamble
type ChunkRequest:
    seed: string
async def generate(request: ChunkRequest, cancellation: Cancellation) -> Bytes:
    return uint16Buffer(1).toBytes(ByteOrder.little)
-->
```velar fragment
import {ByteOrder, Bytes, uint16Buffer} from "velar/binary"
import {Cancellation} from "velar/task"
import {serveWorker} from "velar/worker"

serveWorker(ChunkRequest, Bytes, async (request, cancellation) =>
    await generate(request, cancellation)
)
```

The caller owns a bounded worker or pool with `using`. Runtime `Type` values
validate both message directions. `Bytes` is transferred, cancellation belongs
to each call, and queue capacity rejects overload instead of accumulating an
unbounded generation backlog.

<!-- velar-preamble
type ChunkRequest:
    seed: string
const request: ChunkRequest = {seed: "world"}
const cancellation: Cancellation? = null
-->
```velar fragment
import {Bytes} from "velar/binary"
import {Cancellation} from "velar/task"
import {workerPool} from "velar/worker"

async def generateChunk() -> Bytes:
    using terrain = workerPool("terrain", ChunkRequest, Bytes, 4, 32)
    return await terrain.call(request, cancellation, 5s)
```

## Binary transport and persistence

The same `Bytes` flows through all official boundaries:

- Node `velar/fs`: `readBytes`, `writeBytes`, and exclusive `createBytes`.
- Node/Web `velar/http`: a Bytes request body and response `.bytes()`.
- Node/Web `velar/websocket`: string or Bytes messages over a bounded pull
  connection. Node `listen` can share its HTTP port with a `velar/serve`
  handler.
- Node `velar/sqlite`: parameterized BLOB values, typed rows, prepared
  statements, and explicit transactions in an isolated database Worker.
- Web `velar/storage`: IndexedDB `getBytes`, `setBytes`, and atomic `batch`.

MessagePack, compression, and noise use the official `velar/msgpack`,
`velar/compression`, and `velar/noise` adapters. They are backed by `msgpackr`,
`fflate`, and `simplex-noise`, but those packages do not define the VelarScript
surface.

SQLite transactions and every Worker, Task, WebSocket connection, server,
statement, and database are owned handles. Use `using`; an uncommitted
transaction rolls back, active work is cancelled and joined, sockets close, and
queued callers receive the resource's terminal error.

## Acceptance contract

The permanent gate compiles one `world-core.vel` into Node and browser Worker
graphs, produces byte-identical 16 by 16 by 16 Chunks, exercises pool
cancellation, MessagePack plus compression, binary WebSocket and HTTP traffic,
SQLite and IndexedDB restoration, slow-client backpressure, and disconnect
cleanup. It also measures direct range lowering against the prior materialized
path so the historical hot-loop penalty cannot silently return.

Run the focused evidence with:

```sh
node --test tests/minecraft-readiness.test.ts
```
