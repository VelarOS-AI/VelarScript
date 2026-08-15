# Design decisions

This directory is the historical archive of VelarScript's design rulings — the
record of *why* the language is shaped the way it is. It is **read-only
history**: nothing here is a specification of current behaviour, and nothing
here needs to be read to use the language. The current contracts live in
[the language charter](../language-charter.md), [the standard library
reference](../standard-library.md), and [the Web framework API](../web-api.md).

Come here when you want to know why a decision went the way it did — which
alternatives were on the table, what evidence decided it, and what would have
to change for it to be reopened. Each record is numbered `D<n>` and keeps the
numbered rule items it introduced; later records supersede earlier ones where
they conflict, and say so in their own text.

Most records are written in Chinese, the language the rulings were made in;
their titles are reproduced verbatim below.

## Records

| Record | Title | What it settles |
| --- | --- | --- |
| [D17](D17-METHOD-STYLE.md) | dot-method APIs for strings and numbers | Strings and numbers get method-style APIs (`.trim()`, `.toString()`) so they read like the collection APIs instead of a second, function-shaped vocabulary. |
| [D18](D18-VELAR-SERVE.md) | first-party local platform surface (velar/serve, velar/fs, velar/env, velar/host) | The local platform (HTTP serving, filesystem, environment, host) becomes standard-library modules rather than a compiler extension, so third-party `extern` stops being the way to reach the machine. |
| [D19–D24](D19-D24-ERGONOMICS.md) | 语言人体工学批次 | The ergonomics batch: two-slot `for`, `range`, and the neighbouring conveniences, each specified so single-slot behaviour is untouched. |
| [D26](D26-DEEP-REACTIVITY.md) | 深层响应式为唯一默认 | Property-level deep reactivity is the one default — nested mutation just publishes — and there is no `memo`/`batch`/`frozen` escape hatch to learn. |
| [D28](D28-SPELLING-UNIFICATION.md) | 拼写统一三则 | Three spelling unifications, decided on the standing test: normal language usage first, then what a blind writer types without the docs, then one obvious spelling over a shorter one. |
| [D29](D29-EXPRESSIVENESS-AUDIT.md) | 表达力税、采用缺口与一致性 | The expressiveness audit: which taxes are real (`isInteger()`, positional-argument tightening, discarded failing results) and which proposals were evaluated and dropped. |
| [D30](D30-LEXICAL-AUDIT.md) | 第二轮语法排查：保留字、字面量、优先级、语句纯度 | Lexical round: reserved words soften, and literal, precedence, and statement-purity rules are pinned by compiler probes. |
| [D31](D31-STRUCTURAL-AUDIT.md) | 第三轮语法排查：模块环、组件契约、泛型推断 | Structural round: module initialization cycles become a compile-time rejection, component contracts tighten, and JSX spread is admitted. |
| [D32](D32-COERCION-AND-OWNERSHIP.md) | 第四轮语法排查：强转洞、浮动 Promise、混用括号 | Coercion holes close (f-string and `str()` get a conversion allowlist) and fire-and-forget gets the `async` statement instead of a wrapper function. |
| [D33](D33-AI-NATIVE-DISTRIBUTION.md) | 使命定位成文 + AI Skill 内置分发 + 逃生通道建设 | The mission on the record — "AI writes, humans own" — plus the two product promises it implies: the AI skill brief ships with the installer, and the JavaScript escape hatch must always hold. |
| [D34](D34-ADVANTAGE-ROADMAP.md) | 优势与高级功能路线图 | A living roadmap of advantage lanes built on the extensible language kernel. Explicitly not an implementation spec: every lane needs its own approval. |
| [D35](D35-PARALLEL-ASYNC-AND-NAMESPACES.md) | 并行异步拼写 + 标准库常驻命名空间 | Parallel async gets a real spelling (`all` over a record), and the rule for which standard-library names are permanently in scope without an import. |
| [D36](D36-CHAIN-ATTRS-BIDI.md) | 第六轮语法排查：可选链整尾短路、原生属性表、双向字符 | Optional chaining regains whole-tail short-circuiting, the native attribute table is fixed, and bidirectional characters are banned from source. |
| [D37](D37-WEB-SURFACE-QUALITY.md) | 第七轮语法排查：Look 值收紧与 Web 表面错误质量 | Look string values are checked against a per-property keyword table, and the Web surface's error quality is raised to match. |
| [D38](D38-MECHANICAL-FIXES-AND-IMPORT-TYPE.md) | 第八轮语法排查：extern 吞没、自动修复类、import type | `extern` member resolution stops swallowing failures silently, `import type` is admitted, and the mechanically auto-fixable defect class is separated out. |
| [D39](D39-ADDITIONS.md) | 第九轮（生成性评审）：using、try 表达式、时长、test 块 | The generative round — what is worth *adding* rather than what is broken: `using` resource binding, `try` as an expression, durations, and `test` blocks. |
| [D40](D40-PERCENT-AND-UNITS.md) | `%` 提升 Core 与单位系统三层裁决 | The unit system in three layers — and the record of `%` being promoted to Core and then **withdrawn**, because a user challenge exposed position-dependent semantics. |
| [D41](D41-BOUNDS-AND-POP.md) | 封闭词汇类型约束 + `pop` 去重 | Bounded polymorphism over a closed vocabulary (`<T: Text>`), and the removal of `pop` as a duplicate of `removeLast`. |
| [D42](D42-EQUALITY-AND-ORDER.md) | 相等与有序的统一收紧 | One principle behind two tightenings: a comparison between types that cannot intersect has a constant result, which is a silent logic bug, not a coercion convenience. |
| [D43](D43-NAME-OWNERSHIP.md) | 名字所有权统一约定 + 装饰器永久排除 | One convention for every compiler-owned name (`@name`), replacing five coexisting mechanisms — and decorators ruled permanently out. |
| [D44](D44-AUDIT-RULINGS.md) | 完整性审计的五条裁决 | Five semantic questions raised by the class-system and narrowing audits, settled — starting with record validation rejecting non-plain objects. |
| [D45](D45-CLASS-SURFACE-RULINGS.md) | 类表面的五条收尾裁决 | The class surface's remaining five, including the ruling that a class name is not a first-class value. |
| [D46](D46-BACKTICK-STRINGS.md) | 字符串反引号写法 | Backtick strings, with the same semantics as double-quoted ones, so JSON-in-string fixtures stop being a wall of escapes. |
| [D47](D47-MORNING-RULINGS.md) | 晨间五裁决 | Five rulings including `equals(a, b)` as the prelude spelling for deep equality — collection `==` stays reference identity. |
| [D48](D48-STDLIB-BOUNDARY.md) | 标准库成员边界 + 库分发模型 | What may live in the standard library at all: editor-domain modules are evicted, and libraries are distributed as packages instead of being carried into the stdlib by one application's needs. |
| [D49](D49-KEYFRAMES.md) | 受检的 keyframes 声明形态 | Animation enters the language as a checked `keyframes` block plus an `animate` builder, rather than as unchecked CSS strings. |
| [D50](D50-FINAL-RULINGS.md) | 剩余开放问题的终局裁决 | The endgame ruling set, headed by error discriminability: the class is the only classification and `code` is its stable string projection. |
| [D51](D51-SURFACE-RULINGS.md) | 新表面审计与盲测二轮的设计裁决 | Design questions from the ~600-probe surface audit and the second blind test, including the rule that an owned resource may not escape its scope. |
| [D52](D52-IMPORT-STYLE-AND-REPO.md) | 导入风格回调 + 仓库整理 | Invented prefixes (`Look.`, `Text.`) are withdrawn in favour of named imports — only namespaces that mirror a JavaScript global keep a prefix — plus the repository layout this directory is part of. |
| [D53](D53-EMBEDDED-SOURCE.md) | 内联外语源码块 | Inline foreign source blocks: a good spelling for inline JavaScript, which was already executable through a `data:` URL, and the injection channel editors need. |
| [D54](D54-CONSIDERED-AND-REJECTED.md) | 考虑并否决 | Features proposed seriously and rejected deliberately, each with its reasoning and its reopening condition — so a returning proposal is read, not re-debated. |
| [D55](D55-GENERIC-TYPES.md) | 泛型类型与泛型类 | Generic types and generic classes, established as a completion of the existing design rather than a reversal of it. |

## archive/

[`archive/`](archive/) holds the marathon's **process artifacts**: completeness
audit ledgers, defect lists, per-wave implementation reports, blind-test
ledgers, and the task briefs handed to implementing agents. It also holds
[`HANDOFF.md`](archive/HANDOFF.md), the long working handoff that ran the
project's early phase; the numbered records above superseded it as the
authoritative design log, and it stops partway through that history.

These are kept for provenance — they show what was probed and what was found —
but they are not decisions and there is no reason to read them. Where they
matter, the decision records above cite them.
