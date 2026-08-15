# D53 — 内联外语源码块（用户裁决 2026-08-15）

用户提出：把原生 JS 写在反引号串里（JS 生态 `` html`…` ``/`` sql`…` `` 的成熟
做法），编辑器可据标记做语言注入；不支持插值但要有**注入通道**；允许**不写
声明、作者自负**。编排代理就 `ts`/`html`/`sql` 提出不同意见，用户**同意**该范围。

## 前提事实（实测，非推断）

- **内联 JS 今天已经能跑**，只是拼写惨不忍睹：
  `import js unsafe {hash} from "data:text/javascript,export function hash(t){…}"`
  —— 真实可执行（探针验证）。
- **而把同样的 JS 放进隔壁文件反而被拒**：`import js unsafe {x} from "./helper.js"`
  → `Relative JavaScript import target cannot be emitted; move it into a package`。
- 所以本条**不是新增能力，是给已有能力一个好拼写**，并顺带消灭上述不一致。

**为什么反引号串形态优于「Vel 文件内的 JS 语法块」**（编排代理原方案 B）：
JS 待在**字符串**里 —— Vel 的解析器根本不需要认识 JS 文法，格式化器不必处理
外来语法，诊断不必跨语言。编辑器侧靠标记做注入，是 JS 生态已验证的路子。
反引号是 D46 刚落地的载体，现成。

---

## 第 117 条 —— `extern js` / `unsafe js` 内联源码块

### 形态一：带契约（受检，推荐）

```
extern js(factor: number, prefix: string)`
    export function scale(n) { return n * factor }
    export function label(n) { return prefix + n }
`:
    export def scale(n: number) -> number
    export def label(n: number) -> string

print(scale(21))
```

- `extern js` + 反引号串 = **模块源码**；`:` 后缩进块 = **契约**，与既有
  `extern module "pkg":` 的形状**完全一致**（零新概念）。
- 名字**直接进作用域** —— 没有外部模块可指名，故不需要 `import`。
- **副作用值得记**：内联块比 `import js unsafe` **更受检** —— 契约就在下面三行，
  不存在「整个模块变 any」。

### 形态二：无契约（作者自负）

```
unsafe js`
    export function whatever() { return globalThis.someLegacyThing }
`
```

- 导出的一切是 `any`；**必须写 `unsafe`** —— 该词在本语言里已经是「我自己负责」
  的唯一说法（`import js unsafe`、`import css unsafe`、`unsafe:html`），
  **复用而不发明第二个**。
- 这比现状**更诚实**：`import js unsafe` 是整个模块隐式变 any；显式块一眼可见。

### 注入通道：参数绑定，不是文本替换

**不支持插值**（串按 raw 语义：`\n` 是两个字符，`${}` 与 `{}` 都是字面文本）。
值经**捕获参数表**跨界：括号内声明的名字在 JS 模块作用域里是**真正的绑定**
（发射为模块参数），不是拼进源码的文本。

理由：文本插值等于**用字符串拼接生成代码** —— 注入风险，且读者要在脑内跑一遍
拼接才知道最终代码长什么样。**值走契约，不走文本**，这正是契约存在的意义。

### `css` 同规则

```
unsafe css`
    @keyframes shimmer { from { opacity: 0.4 } to { opacity: 1 } }
`
```

内联 CSS 与外部 `import css unsafe "./x.css"` 同语义（`before`/`after look`
的定位规则一并适用）。**它是真需求**：审计确认 keyframes 之外的动画今天只能靠
原生 CSS，而唯一的路是引外部文件。CSS 无「契约」概念，故只有 `unsafe` 形态。

### 明确不做（连同理由，供将来复核）

| 候选 | 不做的理由 |
|---|---|
| **`ts`** | ① 要背一个 TS 编译器进工具链（版本/tsconfig/装饰器/路径映射，长期流血的依赖）；② **收益很窄** —— TS 类型**不跨进 Vel**，契约照样要在 Vel 侧声明，所以只买到「块内部有类型检查」，而块内部按定义是几行逃生代码；③ **两套类型系统同处一文件且互不认识**，对「人来读」是最坏形态；④ 真要写 TS 说明规模已够大 —— 那该是独立的包（现成的路） |
| **`html`** | Vel 已有 JSX 与 `unsafe:html`，再加一个是第三种拼写 |
| **`sql`/`graphql` 等纯标记** | 它们**不执行**，标记纯给编辑器看 —— 于是制造了同一字符串值的第二种拼写（`` sql`SELECT 1` `` 与 `"SELECT 1"` 值相同），收益只有高亮；且词汇表开放则打错字静默失效、封闭则要维护「祝福哪些语言」的表。**更好的办法**：Vel 自有 LSP 按**参数类型**注入 —— 库把参数声明成 SQL，编辑器自动按 SQL 高亮，**零新语法、对任何库自动生效**、AI 不必记住合法标记 |

### 待实施者定案并呈报的角落

1. **位置**：编排代理倾向**仅模块顶层**（与 `extern module` 一致）；函数体内的
   块会让「这段 JS 什么时候求值」变得不明显。
2. **多块互引**：倾向各自独立模块、互不可见（要共享就合成一个块）。
3. **发射形态**：独立模块文件 vs 内联；无论哪种，**必须 source-map 回 `.vel`
   的行号**（否则逃生通道自己变成不可调试的黑箱）。
4. **CSP**：生产构建的 CSP 是钉死的（有验收门禁）。内联 JS 必须以**不违反 CSP**
   的形态落地（大概率是发射成独立文件而非 inline script）—— **这条必须先想清楚
   再动手**，它决定形态 3。
5. **`velar fix`**：`data:text/javascript,` 旧形态可机械改写为新形态吗？若可证
   等价则入家族（D50 第 95 条判据）。
6. 相对 `.js` 文件是否随之放开 —— **本波不做**：先给一条好拼写，别一次给两条；
   盲测与裁判迁移**一次都没撞上「我需要写原生 JS」**，真实频率待观察。

### 回归

带契约块的受检调用（执行级）、捕获参数真的跨界且类型受检、`unsafe` 块的 any
传播、插值不发生（`${}`/`{}` 是字面文本）、CSS 块与外部 import 同语义、
source-map 落在 `.vel` 行、CSP 生产构建通过、块内语法错误的诊断落点。
