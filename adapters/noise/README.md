# @velarscript/noise

An independently versioned deterministic simplex-noise adapter backed by
`simplex-noise`. A seed always produces the same field and every coordinate is
checked to be finite.

```velar
import {simplex3} from "@velarscript/noise"

const terrain = simplex3("world-7")
const height = terrain(4, 0, 9)
```
