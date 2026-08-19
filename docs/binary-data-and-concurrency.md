# Binary Data and Structured Concurrency

VelarScript provides one target-neutral contract for checked binary memory,
deterministic computation, owned concurrent work, bounded transports, and
binary persistence. The same application core can run in Node and browser
Workers without project-local unsafe JavaScript or host-specific byte types.

## Hot loops and packed numeric data

A direct `for index in range(...):` is a compiler-recognized counter loop. Its
arguments are evaluated once and receive the same integer, direction, step,
finite-progress, and one-million-iteration checks as `range(...)`; it simply
does not allocate and validate an intermediate List. Using `range` anywhere
else still produces the public `List<number>` value.

`Bytes` is a read-only snapshot for protocols and persistence.
`UInt16Buffer` is fixed-size mutable numeric memory. `UInt8Buffer` holds compact
flags or samples; `UInt32Buffer` and `Float32Buffer` hold larger integer and
floating-point datasets. All have strict numeric and index bounds, and their
`[]` operations use compiler-specialized lowering. Fixed buffers have independent
`copy` and `slice`; bounded `UInt32Builder` and `Float32Builder` collect
variable-size output before producing one exact transferable buffer. Construction and runtime
`Type.is`/`Type.parse` enforce the same 64 MiB byte ceiling before scanning or
copying external typed arrays; exactly 64 MiB is accepted and any larger value
is rejected.

```velar fragment
import {ByteOrder, Bytes, uint16Buffer} from "velar/binary"

def packedDataset() -> Bytes:
    const values = uint16Buffer(4096)
    for index in range(values.size):
        const flags = (index >> 8) & 0x0f
        values[index] = (flags << 12) | 0x003
    return values.toBytes(ByteOrder.little)
```

Radix integer literals and bitwise operators are checked rather than coerced.
Data operands must be 32-bit integers and shift counts must be within `0..31`.

## Reproducible computation

Use `velar/random` and `velar/noise`, never host `Math.random()`, for reproducible
data. String and safe-integer seeds produce the same stream in Node and every
supported browser. `fork(label)` derives a stream that is independent of the
parent's consumption order, which makes scheduling order irrelevant to output.

Long-running generators accept `Cancellation` and place explicit checkpoints
at a useful granularity. A timeout on a Task or Worker call cancels the owned
work instead of merely abandoning an outer Promise.

```velar fragment
import {ByteOrder, Bytes, uint16Buffer} from "velar/binary"
import {random} from "velar/random"
import {Cancellation} from "velar/task"

type DatasetRequest:
    seed: string
    partitionX: number
    partitionY: number

async def generate(request: DatasetRequest, cancellation: Cancellation) -> Bytes:
    const stream = random(request.seed).fork(f"{request.partitionX}:{request.partitionY}")
    const values = uint16Buffer(4096)
    for index in range(values.size):
        if (index & 0x7f) == 0:
            await cancellation.checkpoint()
        values[index] = stream.bool(0.5) ? 1 : 0
    return values.toBytes(ByteOrder.little)
```

The complete runnable shared-core example is the repository's
`tests/fixtures/binary-data-pipeline` project. It is the acceptance contract, not
sample-only pseudocode.

## Worker ownership

Declare Worker source entries in `velar.json`; do not construct host URLs:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "workers": {"processor": "src/data-worker.vel"}
}
```

The entry serves one checked request/response protocol:

<!-- velar-preamble
type DatasetRequest:
    seed: string
async def generate(request: DatasetRequest, cancellation: Cancellation) -> Bytes:
    return uint16Buffer(1).toBytes(ByteOrder.little)
-->
```velar fragment
import {ByteOrder, Bytes, uint16Buffer} from "velar/binary"
import {Cancellation} from "velar/task"
import {serveWorker} from "velar/worker"

serveWorker(DatasetRequest, Bytes, async (request, cancellation) =>
    await generate(request, cancellation)
)
```

The caller owns a bounded worker or pool with `using`. Runtime `Type` values
validate both message directions. A call snapshots caller-owned transferable
data before the snapshot's full-storage `Bytes` and numeric buffers are
transferred, even when nested in checked records, Lists, Maps, or Sets; the
caller's buffers remain intact. Traversal is cycle-safe and bounded by depth,
node count, transfer count, and total bytes. Cancellation belongs to each call,
and queue capacity rejects overload instead of accumulating an unbounded
work backlog.

<!-- velar-preamble
type DatasetRequest:
    seed: string
const request: DatasetRequest = {seed: "dataset"}
const cancellation: Cancellation? = null
-->
```velar fragment
import {Bytes} from "velar/binary"
import {Cancellation} from "velar/task"
import {workerPool} from "velar/worker"

async def generateDataset() -> Bytes:
    using processor = workerPool("processor", DatasetRequest, Bytes, 4, 32)
    return await processor.call(request, cancellation, 5s)
```

## Binary transport and persistence

The same `Bytes` flows through all official boundaries:

- Node `velar/fs`: `readBytes`, `writeBytes`, and exclusive `createBytes`.
- Node/Web `velar/http`: a Bytes request body and response `.bytes()`.
- Node/Web `velar/websocket`: string or Bytes messages over a bounded pull
  connection. Both targets enforce message count and aggregate queued bytes;
  normal EOF preserves already accepted messages until `next()` drains them,
  while limit/protocol failure discards the unread queue immediately. Node
  `listen` can share its HTTP port with a `velar/serve` handler.
- Node `velar/sqlite`: parameterized BLOB values, typed rows, prepared
  statements, and explicit transactions in an isolated database Worker.
- Web `velar/storage`: IndexedDB `getBytes`, `setBytes`, and atomic `batch`.

MessagePack, compression, and noise use the official `velar/msgpack`,
`velar/compression`, and `velar/noise` adapters. They are backed by `msgpackr`,
`fflate`, and `simplex-noise`, but those packages do not define the VelarScript
surface. Inflate and gunzip feed the decoder compressed input slices that shrink
with the remaining output budget. The first output callback that would cross
`maxBytes` aborts the decoder, so it neither reserves the default 64 MiB for a
small payload nor continues consuming the compressed tail of a hostile stream.

SQLite transactions and every Worker, Task, WebSocket connection, server,
statement, and database are owned handles. Use `using`; an uncommitted
transaction rolls back, active work is cancelled and joined, sockets close, and
queued callers receive the resource's terminal error.

## Acceptance contract

The permanent gate compiles one `shared-data.vel` into Node and browser Worker
graphs, produces a byte-identical 8,192-byte dataset, exercises pool
cancellation, MessagePack plus compression, binary WebSocket and HTTP traffic,
SQLite and IndexedDB restoration, slow-client backpressure, and disconnect
cleanup. It also measures direct range lowering against the prior materialized
path so the historical hot-loop penalty cannot silently return.

Run the focused evidence with:

```sh
node --test tests/binary-data-pipeline.test.ts
```
