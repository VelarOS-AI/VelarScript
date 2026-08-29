# D110 — 表面版本分区：一个安装号，五个表面号

Status: accepted — 2026-08-29（所有者裁决）

## 背景：一个数字盖住了五件事

今天 `npm` 包版本统一步进——compiler / cli / core / web / node / server /
desktop 全是 `0.25.0`——而每个扩展的契约版本各自独立演进：

| 面 | 契约版本（今天） | 拥有它的常量 |
|---|---|---|
| Web | 0.11 | `VELAR_WEB_API_VERSION` |
| Node | 0.16 | `VELAR_NODE_API_VERSION` |
| Server | 0.15 | `VELAR_SERVER_API_VERSION` |
| Desktop | 0.10 | `VELAR_DESKTOP_API_VERSION` |
| **Core（语言本身）** | **没有** | **不存在** |

两个后果，都已经可以观察：

1. **Desktop 的契约从 0.10 一步没动，它的包却跟着涨到 0.25.0。** 读者看到
   「desktop 0.25.0」，无从知道那一面其实什么都没变。
2. **升级不告诉你该复查什么。** 从 0.23 升到 0.24，changelog 正文里藏着答案，
   但没有任何一个数字说「只有 Web 动了」。对一门明确不承诺向后兼容的语言
   （`docs/why-velarscript.md`「Honest boundaries」），这正是升级时最该拿到的信息。
3. **散文里的版本号会漂。** 官网一次性积累了 24 处手写的 `0.20.0`，在 0.24
   对齐时全部过期，只能逐处替换并重跑转录才敢改。手写的数字必然漂。

`protocolVersion: 1`（CLI 与扩展之间的管线契约）是第三层，与本裁决无关，不动。

## 裁决

### 第 1 条 —— 版本绑「表面」，不绑包

被版本化的东西是**可观察的表面**，不是 npm 包。Core 面横跨 `packages/compiler`
（词表、类型、语句构造）与 `packages/core`（标准库）；Web 面横跨 `packages/web`
的编译期与运行时。按包发版永远表达不了这件事，按面就顺了。

**五个面**：`core`、`web`、`node`、`server`、`desktop`。

### 第 2 条 —— 正式名词是「表面版本」（surface version）

五个面**共用同一个名词**。charter 已经在用 surface 指语言的可观察拼写面
（"the source surface"、"the language surface"），它对语言与扩展同样准确。

不得为 Core 与扩展各起一个名字——那正是 D104 刚清理掉的分裂形态。

**线上字段不动**：`contract.apiVersion` 属于 `protocolVersion: 1`，改字段名
就是改协议。字段保持 `apiVersion`；面向用户的文本（CLI 输出、文档、changelog、
诊断、官网）一律用「表面版本 / surface version」。若将来开 protocol 2，字段随之
更名。

### 第 3 条 —— Core 获得它的第一个表面版本，从 `0.1` 起

Core 面此前没有任何版本标识，本裁决补上：**`core` 表面版本自 0.25.0 起计，
起始值 `0.1`。**

**不回算历史。** `0.N` 里的 N 是「这一面的表面自开始计版以来改过几次」，
**不是成熟度**。因此 core 的 `0.1` 小于 web 的 `0.11`，这不表示 core 比 Web 年轻，
只表示 core 的计数从今天开始。changelog 必须写明这一句，否则数字会被误读。

按历史 tag 回算摘要以补齐 core 的真实历史，是**被考虑并明确拒绝**的：代价高，
而它买到的东西（一段追溯的计数）没有任何消费者。

### 第 4 条 —— 表面版本由摘要门禁强制，不靠人写

这是本裁决与「在文档里标一下版本」的全部差别。手写的版本号会漂（背景第 3 点），
**所以它必须被算出来。**

前置条件已经成立：覆盖率门禁（D56 第 129 条 + D62）已把整个语言表面变成可枚举的。
实测 886 个编译器声明的名字，**零个反查不到的洞**——「every vocabulary this gate
names is read from a compiler-owned table」。每张表都能追溯到拥有它的包，
**因此每个名字属于哪一面，今天就是已知事实。**

裁定机制：

1. **按面计算表面摘要。** 归属按拥有该表的包判定：`packages/compiler/**` 与
   `packages/core/**` → `core`；`packages/web/**` → `web`；其余同理。
   摘要 = 该面全部「类别:名字」对排序后的 SHA-256。
2. **`surface-lock.json` 签入仓库**，记录每个面的 `{version, digest}`。
3. **门禁**：重算摘要并与锁文件比对。摘要变了而版本没变 → **构建失败**，
   诊断给出修法：同一个提交里 bump 该面版本并更新锁文件。
4. 这与 `check-tour-coverage.mjs` 的 `FLOORS` 是同一个形状——
   「a floor that shrinks is a deliberate act, which is why it is acknowledged
   here rather than silently lowered」。表面变化同样是一次自觉行为。

**bump 规则**：该面表面的任何增、删、改 → `N + 1`。语言处于 pre-1.0 且不承诺
兼容，因此不背 semver 的 major/minor/patch 语义包袱：一个计数器，一条规则。

### 第 5 条 —— `velar.json` 声明面版本，编译器校验

**所有者裁决：需要声明。**

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "extensions": ["@velarscript/web"],
  "surfaces": {
    "core": "0.1",
    "web": "0.11"
  }
}
```

语义：

- **`surfaces` 是可选键，但一旦出现就必须完整**——`core` 加上每个被激活扩展
  对应的面，不多不少。少一个面、多一个未激活的面，都是错误。
  「部分声明」是笔误，不是一种用法。
- **声明值与已安装值不一致 → 编译错误**，诊断点名该面、并列声明值与安装值，
  指向 changelog 中对应的面小节。这正是本裁决要买的东西：升级时**强制复查**，
  而不是让漂移静悄悄通过。
- **`velar create` 的全部模板脚手架出 `surfaces`**，因此新项目天然带着它。
  仓库内现有的全部 `velar.json`（tour 四个项目、`examples/app`、模板、官网）
  一并补齐。
- **不 bump `formatVersion`。** 键是新增且可选，旧清单继续加载；把它改成硬性
  必需需要 formatVersion 2 → 3，那是一次独立裁决，**本裁决明确不做**——
  实践中仓库内每个清单都会带上它，硬性必需买到的增量不值一次格式破坏。

### 第 6 条 —— 落点：四处，全部从工具链读取

1. **`velar --version`** 印列车号加五面表：

   ```
   velar 0.25.0
     core@0.1   web@0.11   node@0.16   server@0.15   desktop@0.10
   ```

2. **CHANGELOG**：每个 `###` 面小节挂上该面的表面版本。文件**已经按面分节**
   （`### Web`、`### Core and CLI`、`### Desktop`），这一步近乎免费。
3. **`velar.json`**：第 5 条。
4. **官网**：各面页面的版本号**从工具链读取**，不再手写。这直接消灭背景第 3 点
   那一类缺陷。

### 第 7 条 —— `@` 记法只出现在输出与散文里

`core@0.1` 这个写法读起来好，且模型认得（npm 的 `pkg@version`）。允许用于
**CLI 输出、文档、changelog、官网**。

**不得进入源码语法。** D104 之后 `@` 正式是「标记引导符」，指代编译器拥有的
封闭角色；让它在源码里再指第二件事，就是刚清理掉的词义碰撞原样回来。
`velar.json` 是 JSON 而非源码语法，`"web": "0.11"` 不受此限。

## 这个数字给读者什么

全部价值在这里。今天从 0.23 升到 0.24，你不知道该复查哪些代码。有了表面版本：

```
velar 0.25.0   core@0.1 (unchanged)  web@0.12 (was 0.11)  node@0.16 (unchanged)  desktop@0.10 (unchanged)
```

一眼看出只有 Web 代码需要复查。若该项目的 `velar.json` 声明的是 `web: "0.11"`，
编译器会拒绝并点名，复查因此是**强制的**，不是自觉的。

一个不改变任何决定的版本号是装饰。这一条是本裁决对每个新数字的验收标准。

## 所有权与落点

- 五个 `VELAR_*_API_VERSION` 常量继续由各自的包拥有；新增 Core 的那一个。
- `surface-lock.json` 与摘要门禁归仓库根的 `scripts/`，与 `check-tour-coverage.mjs`
  同一层。
- 清单校验归 `packages/cli/src/config.ts`（清单的唯一解析处）。
- 未来新增的面沿用这一套：一个常量、一个锁条目、一个 changelog 小节，
  不得为某一面另起一套版本规则。
