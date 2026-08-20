# @velarscript/compression

An independently versioned, bounded DEFLATE and gzip adapter backed by
`fflate`. Decompression requires or applies a hard output limit and never
allocates an unbounded result.

```velar
import {gzip, gunzip} from "@velarscript/compression"

const archived = gzip(payload)
const payload = gunzip(archived, 8 * 1024 * 1024)
```

HTTP response compression remains an internal concern of the Node server; this
package is the explicit standalone codec API.
