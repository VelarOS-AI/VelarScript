# D60 — web/desktop 展示写出来之后的缺陷批（2026-08-15）

来源：为 D56 写 web 与 desktop 展示时撞出的 10 条。前两条与 D59 第 143 条同族
但**严重度高一个量级** —— 它们不是把代码写难看，是**把能编译的写成不能编译的**。

---

## 第 147 条 —— 格式化器不得把能编译的源码写成不能编译的（最高优先级）

### 实测（我亲自复验）

```
写入   return <p>{text ?? <em>inline</em>}</p>     velar check：通过
格式化 return <p>{text ?? < em > inline < / em >}</p>
之后   velar check：VEL2006 Unexpected tokens in interpolated expression
```

同样影响 `?? <Fallback />`、`?? <br />`。**仅限单行重排路径** ——
同一表达式独占一行放在块形元素里就不受影响。而这恰恰是 charter §14 点名记载的位置。

### 裁决

**格式化器唯一的契约就是保语义。** 它可以把代码写得难看（D59 第 142/143 条在治
那个），但**写出不能编译的东西是另一个量级** —— 一个作者跑了 `velar format`
之后代码坏掉，此后他不会再信任这个工具，而 `velar format` 是本语言
「一种排版」承诺的执行者。

**必须有一条回归钉住这个不变式本身**，而不只是钉住这一个形状：
**取一批能编译的源码，格式化后必须仍然能编译。** 展示的 34 章正好是现成的语料。

同一路径还吞掉 `<` 前的空格（`:​<span>`、`,<i>`）—— 幂等且仍能编译，随手一并修。

## 第 148 条 —— `Component<Signature>` 的导出别名发射出无法解析的 JavaScript

### 实测（我亲自复验）

```
export type RowView = Component<(label: string) -> WebNode>

export component Row(label: string):
    return <li>{label}</li>
```

```
velar check  → Checked 2 modules        （干净）
velar build  → src/q1.vel:2607:25: ERROR: Expected ")" but found ":"
```

发射出的是 `return Component<(label: string) -> WebNode>.is(value, __state);`
—— **把 Vel 的类型语法原样写进了 JavaScript**。非导出的别名没事；
**导出的记录里带一个 `Component<…>` 字段**同样炸。

### 裁决

**`velar check` 通过是一条契约** —— 它的全部意义是「这段代码是好的」。
check 通过而 build 炸，比 check 直接报错**坏得多**：作者已经相信了它。

这条与第 147 条同源：**两条都是工具在自己的承诺内失败。**
修法之外还要一条回归：**展示与示例的每个项目 `check` 之后必须 `build` 得动** ——
今天没有任何门禁把这两步连起来验。

### 第 148.1 条 —— 扩展所有的类型上的 `is`/`parse` 应当被拒，不是恒返回 `false`

修完之后，`export type RowView = Component<…>` 的 `RowView.is(x)`
**发射出一个常量 `false`** —— 那是语言已经为 `kind: "extension"` 类型定下的分支，
所以不是新设计。但它是**一个静默的错误答案**：「没有任何东西是 RowView」是假话。

**裁决：在分析器拒绝** —— 与 `Type<T>` 和类型参数得到的 VEL4022 同一待遇。
本项目从 D42 起一路在拔的就是「编译干净、答案是错的」这一类，
而恒 `false` 正是其中最难发现的形态：它不崩、不报错，只是永远说不。

### 第 148.2 条 —— 本文对第 148 条的归属写错了（自我更正）

我把它归给「`packages/web` 发射路径」。**根因在 `packages/compiler/src/emitter.ts`** ——
Core 的 `emitTypeCheck`。实施波指出：若按我写的归属去修（在
`WebJavaScriptEmitter` 里覆盖），**node、desktop、Core 三处的同一个洞会原样留着** ——
正是本批反复在治的那一族。它越界修了正确的地方并上报，**判断优于规格**。

**而且它证明了那个洞比举报的更宽**：同一行对**合法标识符但无绑定**的名字
（`WebNode`、`Color`、`Length`、裸 `Component`）一直在发射
`WebNode.is(...)` —— 这些**能解析**，所以 `build` 通过，改成运行期 `ReferenceError`。
**响的那个成员盖住了一族安静的。**

## 第 149 条 —— 模块提供的枚举必须有完整的运行时面

| 枚举 | `is` | `parse` | `values` |
|---|---|---|---|
| `velar/http` 的 `HttpTransportPhase` | ✗ | ✗ | ✗ |
| `velar/desktop` 的 `ProjectTaskCommand` | ✓ | ✓ | **✗** |
| `velar/desktop` 的 `ProjectTaskOutputChannel` | ✓ | ✓ | **✗** |

三者**全部编译干净**，运行期 `TypeError: … is not a function`。
`HttpTransportPhase` 被登记成 `enumObject`，运行时却只是
`freeze({request, response})`。成员访问与 `match` 能用（它们降级为 `===`），
所以缺陷只在那三个方法上。

charter §6 把 `is`/`parse`/`values` 写成枚举保留的运行时面。
**裁决：模块提供的枚举一律补齐三者。** 这是「编译干净、运行崩」那一类 ——
本项目从 D42 起一直在拔的正是它。

**并加一条派生门禁**：凡登记为 `enumObject` 的类型，其运行时必须提供这三个
方法。今天两处漏，是因为没有任何东西把「登记」和「运行时」钉在一起 ——
D57 第 134 条那一族的又一例。

## 第 150 条 —— 七个 Look 属性发布了却写不出有意义的值

| 属性 | 唯一能写的 | 被拒 |
|---|---|---|
| `isolation` | `auto`（即默认值） | `isolate` |
| `contain` | `none`（即默认值） | `strict`/`content`/`size`/`layout`/`style`/`paint` |
| `backgroundSize` | 单位值 | `cover`、`contain` |
| `backgroundPosition` | 单位值 | `center`、`top`、`left`… |
| `transformOrigin` | 单位值 | `center` |
| `transitionProperty` | 默认关键字 | 任何属性名 |
| `transitionTimingFunction` | 默认关键字 | `ease-in-out`… |

**`isolation` 与 `contain` 实际不可用** —— 它们唯一合法的值就是自己的默认值，
写不写效果一样。

**裁决：补上各自的关键字集合**（前五个都是很小的闭集），
而不是把它们移进"刻意排除"表。判据是 D50 第 92 条的反面：
那条说「发布一个够不到的名字比不发布更糟」——
**这七个正是"发布了却够不到"**。两个 transition 长手一并给出属性名/缓动词汇。

## 第 151 条 —— `keyframes:` 必须复用 Look 的值检查器

charter §17 明写 keyframes「reuses the Look property and value checker」。
**实测它不复用**：`keyframeCssValue` 是纯语法的，标识符一律返回 `null`。

```
const glow = rgb(120, 150, 255)      color = glow            → VEL5060
const spinTo: Angle = 1turn          rotate = spinTo         → VEL5060
shadow(..., spread = 0px)            写在停靠里              → VEL5060
```

而 look 块**接受** `color = glow`，媒体阈值**明确接受**本地或导入的 const 单位记号。
**于是设计令牌一进动画就得重新手抄成字面量** —— 这正是设计令牌存在的意义被抵消。

**裁决：按 charter 已经承诺的做** —— keyframes 复用同一个值检查器。
charter 不改，改实现。

## 第 152 条 —— web 侧 `Blob` 保留，并写明它是直通令牌（更正两份相反的上报）

两个波给了相反的结论，**都不完整**。实测：

| 探针 | 结果 |
|---|---|
| `http.post("/echo", {body: blob})` | **接受** |
| `blob.size` | `Type 'Blob' has no field 'size'` |
| `readText(blob)`（`velar/files`） | `Cannot assign Blob to File` |

即：web `Blob` **有且只有一个消费方**（HTTP 请求体），**零成员**。

**这与 D57 第 137 条退役的 node `Blob` 不同** —— 那个消费方为零，是死端；
这个是**不透明字节的直通令牌**（取回来、原样转发），一个自洽的设计。

**裁决：保留。** 但 `docs/web-api.md` 要写明它是直通令牌、没有成员，
否则读者会像这两个波一样，各自摸到一半就下相反的结论。

## 第 153 条 —— 能力模块必须在调用时失败，不是在模块初始化时

Desktop 项目的非浏览器 `velar test` **无法加载任何 import 了 `velar/desktop`
的模块** —— `DESKTOP_HOST_ABI_RUNTIME` 在模块初始化就抛。于是
「与能力 import 同处一个模块的纯函数」不可单元测试。

**web 侧不是这样**：盲测二轮撞到的是 `velar/storage requires a browser storage
environment`，**抛在调用时**。

**裁决：统一到 web 的行为 —— 能力在调用时失败，不在模块初始化时。**
理由：模块初始化抛错惩罚的是**没有调用它的代码**；而「把纯逻辑和能力放在同一个
模块」是完全正常的写法，语言不该逼作者为了可测试性拆文件。

## 第 154 条 —— charter:3658 的遮蔽陈述作废（第二次撞见同一句）

```
charter:3658  "A lexical declaration may shadow any permanent namespace"
实测          const Text = 1  →  VEL3007
```

D57 第 135 条落地后这句就是假的。**AI 简报里同一条陈述今天早些时候已经改过一次**
—— charter 这处是**同一个缺陷的第二个副本**，J1 的迁移扫漏了。

记在这里不是为了改一行字，是为了记下**扫漏本身**：一条改变「什么是合法的」的
裁决，必须扫遍 charter、简报、`docs/**` 三处的**散文**，而门禁只编译围栏。
D59 已记下同一族（第 144.1 条的 `??` 例子也是散文，从未被编译过）。

---

## 排期与归属

| 条 | 归属 | 紧急度 |
|---|---|---|
| 147（格式化器毁代码） | `packages/compiler/src/formatter.ts` | **最高** |
| 148（发射无效 JS） | `packages/web` 发射路径 | **最高** |
| 149（枚举运行时面） | `packages/web`、`packages/desktop` + 派生门禁 | 高 |
| 151（keyframes 值检查） | `packages/web/src/keyframes.ts` | 中 |
| 150（七个 Look 属性） | `packages/web/src/look.ts` | 中 |
| 152、154 | 文档 | 低 |
| 153（能力初始化时机） | `packages/desktop` | 中 |

第 147 条**必须与 D59 第 142/143 条同波**（同一个文件），落地后
**重跑 `velar format examples/tour/`** 并重新提交展示。
