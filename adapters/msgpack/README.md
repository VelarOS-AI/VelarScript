# @velarscript/msgpack

An independently versioned MessagePack adapter for VelarScript. It keeps
`msgpackr` behind a checked `.vel` source facade and enforces a 64 MiB encoded
and decoded data boundary.

```velar
import {encode, parse} from "@velarscript/msgpack"

const bytes = encode({name: "Ada"})
const user = parse(bytes, User)
```

This package is not a `velar/*` Standard module and is not released as part of
the language toolchain.
