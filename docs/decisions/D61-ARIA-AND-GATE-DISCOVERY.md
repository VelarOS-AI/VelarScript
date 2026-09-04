# D61 — ARIA 布尔值与门禁的项目发现（2026-08-16）

来源：写 `examples/app` 时撞出的两条，都由实施波上报并请求裁决。

---

## 第 155 条 —— 属性存在性与属性文本使用两种值

### 裁决

所有原生 JSX 属性遵循同一条可见规则：

- `null` 与 `false` 删除属性；
- `true` 写入值为空字符串的存在属性；
- 字符串写入其字面文本。

因此 `disabled={saving}` 直接表达存在性，而 ARIA 的字面 token 用
`aria-busy={str(saving)}` 表达。`aria-busy={false}` 是未指定，
`aria-busy={str(false)}` 才是明确的 `aria-busy="false"`；两者不会共享一个
隐式转换规则。

手写 `saving ? "true" : "false"` 与 `str(saving)` 等价但更长。编译器以 A14
提示前者。等价性证明只覆盖恰好两个字符串分支的非可选 bool 转换和原生文本属性；
HTML 布尔/存在性属性与组件参数不在范围内。机械修复还要求将被丢弃的部分没有
注释；条件本身按原文放进 `str(...)`，其中的注释会被保留。

### 回归

浏览器回归同时读取动态 `data-*`、ARIA 和 HTML 布尔属性：`false` 与 `null` 时
按存在性消失，`str(false)` 保留字面文本；切换为 true 后，存在属性值为空字符串，
`str(true)` 的值为 `"true"`。裸属性统一写为空字符串。

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
