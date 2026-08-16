# D65 — Look 关键字属性的不变量（2026-08-16）

来源：波 P1 修完 D60 第 150 条那七个属性后上报 ——
**这一族比举报的宽,而且它有更坏的一面。**

---

## 第 168 条 —— 凡 `keyword` 类属性必须自带闭集,否则模块加载即失败

### 现状:20 个属性没有自己的词表,全部落到通用兜底表

后果有两面,**第二面比第一面坏得多**:

**A. 真值被拒**(与那七个同型,12 例):

```
VEL5038: Look property 'objectPosition' does not accept '50% 50%'
VEL5038: Look property 'borderStyle' does not accept 'groove'
VEL5038: Look property 'textDecorationLine' does not accept 'underline'
VEL5038: Look property 'listStyleType' does not accept 'upper-roman'
…
```

**B. 假值被收 —— 编译干净、浏览器丢弃**(12 例,我复验):

```
strokeLinecap = "none"      borderStyle = "smooth"      fontStretch = "circle"
gridAutoFlow = "none"       colorScheme = "none"        textRendering = "square"
objectPosition = "none"     scrollSnapStop = "dark"     listStyleType = "start"
```

全部 `Checked 1 module`。**它们发射成真实 CSS 声明,浏览器静默丢掉。**

### 展示自己就在写假值 —— 这条最要紧

`examples/tour/web/06-look.vel` 里有 `objectPosition = "none"`、
`gridAutoFlow = "none"`、`strokeLinecap = "none"`、`strokeLinejoin = "none"`、
`colorScheme = "none"` —— **全部是 CSS 不认的值,而它在门禁里一直绿**。

**这暴露了覆盖率门禁的一条真实边界,必须写下来**:

> **它证明的是「这个属性被用到了」,不是「这个属性被用对了」。**

D56 第 129 条的门禁反查词汇表、要求每个名字被解析后的引用够到 ——
那对**名字**是完备的,对**值**什么也没说。20 个属性的覆盖今天是**假的**。

### 裁决

**任何 `kind: "keyword"` 的 Look 属性必须携带自己的闭集;缺失则模块加载即抛。**
机制照 `look.ts` 里已有的那条派生不变量。

**这条同时自我修复展示**:不变量落地后,那 5 个假值变成编译错误,
展示被迫改对 —— **让编译器当验证器,比让门禁去验证 CSS 好**,
因为编译器本来就在那个位置。

## 第 169 条 —— 多 token 值:集合装的是完整值,不是 token

实施波正确地把这一岔口交回来。CSS 里 `scrollSnapType: y mandatory`、
`colorScheme: light dark`、`gridAutoFlow: row dense` 都是多 token。

**裁决:闭集装的是完整值。** `scrollSnapType` 的集合里就写
`"y mandatory"`、`"both proximity"` —— 作者写的正是他从 CSS 认识的那个值,
**不发明新语法,不加新 builder**。

**组合空间关不住的属性**(`contain` 是 `size layout style paint` 的 2⁴ 子集),
**发布够得到的子集并明确记进「刻意排除」表** —— Look 已经有 36 个刻意排除的属性,
多这一类不是新概念。**关键是排除可见,而不是靠兜底表静默收下一切。**

实施波已按此做了 `contain`(单 token 闭集 + `strict`/`content` 两个具名简写)
与 `transitionProperty`(派生自 `LOOK_PROPERTIES` 减去不可插值的),**确认**。

---

## 第 170 条 —— rest 参数按上下文类型化(裁决 D59 第 145.2 条留的岔口）

```
const total: (...values: number) -> number = (...values) => values.sum()
→ VEL2016: A rest parameter requires an element type
```

而**定参是被上下文类型化的**。D59 第 145.2 条给的是「要么一致,要么记录为有意为之
并说明理由」——**裁决:做一致。**

理由与实施波给的相同,我确认它:**这条不对称没有任何论据支撑**。
同一个参数列表里定参被上下文类型化而 rest 不被,作者看不出区别在哪;
而「记录为有意」需要一条说得出口的理由 —— 我也找不到。

实施：`parser.ts` 把无类型 rest 的报错推迟到分析阶段,由上下文函数类型的 rest
提供元素类型;仍无上下文时再报 VEL2016。

## 第 171 条 —— `velar/log` 发布 `LogRecord`（一行,只是文件不归它）

D59 第 145.3 条已裁「发布它」,实施波被边界挡住,给出了准确的落点:
`packages/cli/src/standard-modules.ts` 的 `velar/log` 导出表加
`["LogRecord", {kind: "typeObject", name: "LogRecord"}]`,并把 `logRecordType`
的字段登记进该模块的 `namedTypes` —— 与 `velar/fs` 的 `FileWatchBatch`、
`velar/serve` 的 `ServeRequest` 同法。**无歧义,下一波顺手做掉。**

---

## 确认实施波四处自行判断

1. **`contain` 只收单 token** —— 现存 `LOOK_PROPERTY_KEYWORDS` 每一条都是单 token,
   保持一致是对的;组合值按第 169 条处理。
2. **`transitionProperty` 排除不可插值属性** —— keyframes 已用同一张表拒绝它们,
   两处一致。
3. **字符串常量算静态令牌** —— `const bodyFont = "Inter, …"` 同样是设计令牌,
   不纳入会立刻变成下一份上报。副作用(导出字符串进模块接口标识)是**必要的**:
   下游 keyframes 引用了值,值变了就该重建。
4. **`asset()` 降级放宽到降级后的字符串** —— 等价扩展,没有收窄。

## 记录:边界外的一处必要改动

实施波改了 `scripts/check-runtime-boundary.mjs`,因为那个门禁**逐字钉着**
它被要求修改的那一行源码。断言的意图(动态项目授权仍走桥字段)未变,
改是机械的,不改则门禁必红。**主动上报,处置正确** ——
这也顺带说明「逐字钉源码」的断言有维护成本,将来若反复出现,值得换成按行为断言。

---

## 归属

第 168/169 条 → `packages/web/src/look.ts` + 展示修正。
第 170 条 → `packages/compiler/src/parser.ts` + 分析器。
第 171 条 → `packages/cli/src/standard-modules.ts`,一行。
