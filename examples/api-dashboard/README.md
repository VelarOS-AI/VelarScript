# VelarScript Metrics

VelarScript Metrics is an application-scale dashboard used to validate typed HTTP
data, concurrent async-arrow data loading, a declared JavaScript package
boundary, component resources, controlled Look values, native class-body state and
construction invariants, and
namespace-correct inline SVG JSX.

```text
velar check .
velar test .
velar test . --browser all
velar build .
```

The chart owns its coordinate ratio in a private `ChartScale` class-body field
instead of exposing derived state as a constructor argument or public member.
The compiler lowers it to native JavaScript private storage and omits it from
the exported class/editor surface. Its explicit constructor validates the
scale before an instance escapes. That class instance
crosses the checked dynamic VelarScript component chunk used for each SVG bar, while
the chart embeds an HTML summary through `<foreignObject>`. The three Core tests
include this failing-construction contract. Its bounds use comparison chains
(`0 < value <= limit`) rather than duplicated operands or JavaScript boolean
coercion.
Its read-only `top` property is declared with `get top() -> number` and drives
the real SVG plot boundary without duplicating derived state or exposing a
setter.
The exported chart type, scale class, and coordinate methods also carry `///`
documentation, proving that application-owned API guidance survives compilation
without becoming runtime code.
Browser tests verify the actual DOM namespace rather than accepting an HTML
unknown element that only looks like an SVG tag in source.

Dashboard metadata and two typed metric feeds stay separate. The feeds load
concurrently through `velar/async.map` with an `async source => ...` worker,
then merge through the checked collection API before rendering.
