# D61 — ARIA 布尔值与门禁的项目发现（2026-08-16）

来源：写 `examples/app` 时撞出的两条，都由实施波上报并请求裁决。

---

## 第 155 条 —— `aria-*` 上的 bool 渲染成字面文本 `"true"` / `"false"`

### 实测

`packages/web/src/emitter.ts:1889`：

```js
function __velarAttributeValue(value, name) {
  if (value === true) return "";      // ← 所有属性一视同仁
```

配合 `__velarAttr` 在 `false` 时**移除属性**。

**这对 HTML 布尔属性是对的**（`disabled`、`checked`、`readonly` 用存在/缺席表意），
**对 ARIA 是错的** —— ARIA 的词汇是**字面 token** `"true"` / `"false"`。

### 它不是「没效果」，是「说反了」

`aria-busy=""` 不是一个合法 token，用户代理按默认值处理 —— 而 `aria-busy` 的默认是
**false**。所以作者写 `aria-busy={submit.pending}`，在 pending 为真时，
**属性宣称的恰好是相反的事实**。

同理 `aria-pressed`、`aria-expanded`、`aria-checked`、`aria-selected`、
`aria-hidden`、`aria-disabled`、`aria-invalid`。移除属性 ≠ `aria-*="false"`：
前者是「未指定」，后者是「明确为否」，两者在辅助技术里不等价。

### 语言自己已经在按正确的方式写

`packages/web/src/runtime.ts:1694`、`:1789` —— `velar/forms` 内部写的是
`formSetAttribute(field, "aria-invalid", "true")` 与 `aria-busy "true"`。
**同一个运行时里，库自己写字符串，作者写的 JSX 得到空串。**

现存语料里已经有一处：`examples/production-web/src/components/newsletter.vel:54`
的 `aria-busy={submit.pending}` 今天渲染出 `aria-busy=""`。
**它在门禁里绿了很久**，因为没有任何东西检查属性的语义。

### 裁决：采纳实施波的建议 ②

**`aria-*` 属性收到 `bool` 时渲染字面文本 `"true"` / `"false"`，且永不移除属性。**
文本、数字、枚举照旧（`aria-label`、`aria-valuenow`、`aria-controls` 不受影响 ——
它们本来就不写 bool）。

不采纳的两条：

- **① 只写进典章**：依赖每个作者记住一条例外，正是「一个拼写一个意思」要消灭的东西。
  而这条例外的**失败是静默的**，且受害者是最没有能力报告它的那批人。
- **③ 报诊断要求显式文本**（`aria-pressed={x ? "true" : "false"}`）：把一个只有
  一种合理解释的写法变成三倍长度的仪式。作者写 bool 的意图在 ARIA 上没有第二种读法。

**判据是双亲法**：母亲（DOM）说 ARIA 取字面文本 —— 行为按母亲；
父亲（拼写）说作者写 `bool` 最自然 —— 拼写按父亲。**这正是两者不冲突的情形。**

### 回归

`aria-*={true}` / `={false}` 各渲染出字面文本；`false` 时属性**仍在**；
非 ARIA 的布尔属性（`disabled`）行为不变；`aria-label={text}` 不受影响。
`newsletter.vel:54` 那处随之修好（若该文件已随退役删除，则在 `examples/app` 或
展示里立一处等价断言）。

---

## 第 156 条 —— 门禁的项目清单必须按目录发现，不许逐个点名

### 现状

`package.json` 的 `gate:test` 与 `gate:test:browser` **逐个点名**四个示例项目
（`production-web`、`flow-board`、`support-desk`、`api-dashboard`），
各跑 `cli check` / `cli test` / `cli test --browser all`。

后果**已经发生**：`examples/app` 写完之后，`check:projects` 自动发现了它
（那条门禁按目录扫），而**它的 21 个测试没有任何门禁在跑** ——
因为那两行点名清单里没有它。

### 裁决：改为按目录发现，与 `check:projects` 同一机制

`examples/` 下每个带 `velar.json` 的目录都要被 `check` / `test`，
有 `*.browser.test.vel` 的还要跑 `--browser`。

**这是 D57 第 134 条那一族的第七例** —— 本该派生的清单被手工维护。
表征这次不是漂移而是**遗漏**：新项目加进来，清单不知道。
形状相同，修法相同：**别往清单里补一行，把清单删掉。**

若某个项目确实要排除（例如刻意不可编译的夹具），
**在脚本里具名排除并写明理由** —— 与 D56 第 129 条的豁免纪律一致：
排除是可见的，遗漏不是。

---

## 归属

第 155 条 → `packages/web/src/emitter.ts`（+ 回归）。
第 156 条 → `package.json` 与退役波同做（退役会删掉那四行点名，正是改造的时机）。
