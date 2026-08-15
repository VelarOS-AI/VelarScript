# D17 — dot-method APIs for strings and numbers (user directive, lead-specified)

User directive: 「尽量使用打点调用的这种方式比如 "".splitt() 0.toString() 这样比较方便写」.
Blind-test evidence: every phase-1/2/3 writer instinctively wrote .trim()/.upper()/.length.
Collections are already method-style; strings/numbers joining them removes the language's
last big API inconsistency and composes with leading-dot chain continuation.

## String methods (Core-checked, like collection methods: compiler-owned helpers,
## named-argument contracts, first-class bindable, receiver evaluated once)

| Member | Contract |
| --- | --- |
| `size` | property, number — code-point count (matches List.size naming) |
| `trim()` | string |
| `upper()` / `lower()` | string |
| `slice(start = 0, end = size)` | string — code-point slice, List.slice semantics |
| `char(index)` | string? — code-point at index, negative from end, null out of range |
| `has(text)` | bool (contains; matches collection has) |
| `startsWith(text)` / `endsWith(text)` | bool |
| `split(separator)` | List<string> |
| `replace(from, to)` / `replaceAll(from, to)` | string |
| `padStart(size, fill = " ")` / `padEnd(size, fill = " ")` | string |
| `repeat(count)` | string — bounded like other growth ops |

Semantics: reuse the just-landed velar/text implementations (code-point length/char/slice,
16 MiB guards, bounded growth) — this is a SURFACE move, not a semantics change.

## Number methods

`abs()`, `round()`, `floor()`, `ceil()`, `toFixed(digits) -> string`.
Lexer: `0.abs()` / `1.toFixed(2)` must lex as literal + member (a digit run followed by
`.` + identifier-start is a member access, not a decimal point). `1.5.round()` also legal.
NO `.toString()` — conversion stays `str(value)` / f-strings (one obvious spelling).

## Removals (no compatibility aliases — guidance instead)

- velar/text string functions (trim/upper/lower/length/char/slice/split/replace/replaceAll/
  padStart/padEnd/repeat/startsWith/endsWith/includes-family): removed. If velar/text
  becomes empty, remove the module and its docs section; if non-string utilities remain,
  keep the module with only those.
- velar/math receiver-shaped functions (abs/round/floor/ceil, and toFixed if there):
  removed; min/max/pow/clamp and other multi-arg non-receiver functions stay.
- ALL existing guidance that pointed JS method spellings AT the functions is inverted:
  `.toUpperCase()` -> "Use '.upper()'", `length(x)`/`.length` -> "Use '.size'",
  `trim(x)` function-call shape -> "Use 'value.trim()'", etc. The old function
  spellings become guided errors (VEL1005/4001 style, same voice).

## Ripples to handle

- Existing repo code using the function forms: examples/*, docs code fences,
  packages (Lite migrates in its own commit).
- The blind-test-era tests asserting function-form guidance flip to method guidance.
- semantic/LSP completion should list string/number members on those receivers.
- charter §7/§8 + standard-library.md rewrite for the string section; CHANGELOG.
- First-class binding: `const cut = title.slice` must work like collection methods
  (receiver captured once) — reuse that machinery.
