# D90：审计裁决 —— 响应式、Look、字符串、NaN 与组合边界（2026-08-20）

## 来源

一次覆盖语言规范、编译器与框架的全面审计：269 条上报，60 条被反驳推翻，
**205 条确认**（其中 19 条落在 D88 移出仓库的生态树里，随代码一并放弃，
见末节）。本文件只裁决其中**改变语言或框架含义**的部分；其余作为缺陷
直接修复，不需要裁决。

判据只有一条，来自定位本身：**别处静默的错误，在这里必须变响。** 一个
行为只要让错误悄悄溜过去而编译器不吭声，它就要改；"怎么改"有多条路时，
才需要裁决。

---

## R1 响应式：改为 glitch-free

**现状**：`runtime-foundation.ts` 顺序刷两条队列（先 `domQueue` 再
`watchQueue`），因此 DOM 在任何 watch 之前就已提交，且 watch 按声明顺序
执行。后果三条，都实测复现过：

- watch 看得见半更新的世界。`watch a + b as sum` 与 `watch a: b = a * 2`
  同时存在时，一次 `a = 1` 先打印 `sum=1`（b 尚未派生），再打印 `sum=3`。
- **把两个 watch 上下调换，同一个程序的输出会变。**
- 纠正型 watch 先把错值推过 DOM：`watch n: if n > 5: n = 5` 在
  `setN(10)` 时先渲染 10 再渲染 5，渲染路径上任何非幂等副作用跑两次。

**裁决**：先把所有派生值与 watch 结算到不动点，**再一次性提交 DOM**。
此后 **watch 的声明顺序不可观测**。`tick()` 同时改为真正排空反应式队列
到静止，而不是固定跳一个 microtask。

**理由**："调换两行的顺序就改变结果"是一条纯靠源码位置、编译器完全看不见
的隐藏依赖——正是定位要消灭的那一类。而且模型是整段重新生成代码的，它
天天在调换顺序。保留这个行为，等于每次模型重写都埋一颗静默地雷。

---

## R2 `key`：语义不变，只修重排 bug

**裁决（所有者直接裁定）**：**不把 React 的写法引进 Vel。** 不为
`items.map(i => ({...i}))` 这种"换掉对象身份"的更新方式做兼容，不放宽
身份判定，也不为它加提示。Vel 的正道是原地改该项的字段
（`items[i].done = true`），行不会被拆，焦点与输入法状态自然保住。模型
写错是模型的问题，框架不为它兜底。

**但**同一区域的重排缺陷是真 bug，必须修：`entry.nodes` 在移动循环之前
只捕获一次，导致键控列表重排时**复活已销毁的 DOM 节点、并遗弃仍然存活的
节点**。这与身份语义无关，照修。

---

## R3 Look：固定规则，覆盖必须显式

**裁决（所有者：「有一套固定的规则就好，不要产生语义上的分歧，覆盖需要
显式指定的行为，而不是静默」）**，落为三条：

**(a) 输出必须确定。** 层叠胜负当前由**模块文件名字母序**决定，而该排序
又受构建机 `LC_ALL` 影响——同一份源码换台机器编出不同样式表、不同内容
哈希、不同 `buildId`，连一年期 `immutable` 缓存头都跟着变。这不是审美
问题，是生产缓存投毒。文件名与 locale 依赖从根上铲除。

**(b) charter 已有的三条规则必须在实现里真的成立。** 它们本来就是"显式
覆盖"的正确形状，只是实现没做到：

- 用 `...baseLook` 铺开基础款再改，**这一行本身就是显式覆盖的拼写**，
  不需要发明新语法；
- 组件调用处写的 `look` 组合在组件自身 host look **之后**，因此
  **调用方赢下双方都设的每一个属性**——包括赢过组件内部的条件规则
  （如 `if @hover:`）。当前实现里组件内部的条件规则会靠特异性反杀调用方，
  是实现违反 charter；
- 同一 Look 作用域内重复设置同一属性**要报告，不是静默丢弃**。

**(c) 剩下的唯一漏洞变成编译错误。** 一个元素上挂两个**互不相干**的 look
（`look={[themeLook, badgeLook]}`）而两者都设了同一属性时，现在靠文件名
决定胜负。此后这是编译错误，消息点名两个 look 与该属性，并教出正确写法：
写一个以 `...themeLook` 打底的新 look。

正当的覆盖不受任何影响——它的意图已经写在结构里；报错只落在真正说不清的
地方，也就是模型犯错、人该被问的地方。不新增任何词，规则 3 保住。

---

## R4 `children`：遵守 Vel 的普通规则

**裁决（所有者）**：`children` 不需要一套自己的心智模型，它遵守 Vel 已有
的规则即可——**响应式状态变了就更新**；在 JSX 里 **`false` 就是不渲染**；
要隐藏但保留状态，作者自己用 `style` / Look 控制，而不是框架隐式代劳。

据此，当前缺陷必须修：children 槽只能实例化一次，被条件藏起来后内容被
永久销毁，再变回 true 是空的。修复后 false→true 必须重新渲染。

组合机制目前**完全不在 charter 里**（D31 批准过要补，未实现）。文档波
必须把它补进规范。

---

## R5 `Type.parse`：返回拷贝

**现状**：`parse` 返回入参的别名。因此 `Profile.parse(view)` 能在零诊断
下写穿一个 `readonly` 参数；已校验的 `number` 字段事后可被改成 string，
`+` 随之变成字符串拼接；对冻结对象的后续写会以宿主 `TypeError` 死掉。
charter 第 887 行明写「恢复可变权限需要显式拷贝」。

**裁决**：`parse` 返回新值。**"已校验"从此意味着"而且它保持有效"**，
而不是"检查那一瞬间是对的"。代价是每次 parse 多一次拷贝——但 parse 正是
从不可信数据跨进可信区的边界，本就该在此付费，没人在热循环里用它。

---

## R6 NaN：统一拦截

**现状**三处政策互相打架：`Math.min/max/clamp` 静默放行 NaN，
`List.min/max/sum` 报错拦截，而泛型排序里 NaN 的 `<=` 与 `>=`
**同时为真**（会产出真正的乱序）。

**裁决**：一条政策——**可以持有 NaN 并用 `value.isNaN()` 检测它，但任何
会比较它或聚合它的操作一律报错**，而不是产出貌似合理实则错误的结果。
`Math.min/max/clamp` 向 List 一侧对齐。`1 / 0`、`0 / 0` 仍按 charter
正常产出其值，`isNaN()` 仍是唯一且正当的检测路径。

**同批**：不可表示的整数字面量不再静默改写。今天 `1e400` 因"非有限"被拒，
而 `9007199254740993` 与 `0x20000000000001` 被静默改写成
`9007199254740992`，`123456789012345678901234567890` 静默变成
`1.2345678901234568e+29`。charter 第 443 行只要求"保持有限"，没有要求
"可精确表示"。此后不可精确表示的整数字面量与 `1e400` 同等对待；显式
十六进制字面量尤其如此——人写 hex 就是要那个精确的位模式。

---

## R7 字符串：统一按码点

**裁决（所有者：「⑧按你的」）**：`size`/`char`/`slice` 与
`has`/`count`/`endsWith`/`split`/`replaceAll` 统一到**码点**，且任何操作
都不得产出孤立代理（今天 `split` 会）。

字素簇**不进 Core**：它需要一张随 Unicode 版本变动的表，对一门永不承诺
兼容的语言是版本噩梦，且过重；它属于文本库。码点是诚实的中间点，与
Python 3、Swift `unicodeScalars`、Rust `chars` 一致，消除了"半个字符"
这个脚雷。非 BMP 字符导致的 O(n) 悬崖是实现问题（ASCII 快路径加惰性
索引），不改变本裁决。

---

## R8 外语反射：警告，而非沉默或拒绝

见 [D89](D89-ADVISORY-CHANNEL.md)，本裁决同批产生。要点：新增**建议
（advisory）通道**，覆盖"模型带着 Python / JavaScript 反射写出、Vel 却
静默接受成别的意思"的拼写；建议可被 `velar-allow <CODE>: <理由>` 抑制，
**不给理由的抑制是编译错误**，过期的抑制同样是编译错误。

`//` 是 Vel 唯一的**行**注释拼写。块注释 `/* */` 另有其形，但它必须闭合，
接不过"注释到行尾"这个角色，也不承载 `velar-allow`（见语言宪章 §2 与 §1 的
抑制三条）。`#` 同样接不过来：`#` 的词法分派依次读
`readJavaScriptPrivateIdentifier`、`readHexColor`、`readHashComment`，裸十六
进制颜色由 `readHexColor` 接住并报 VEL1005、指向带引号的写法；`#` 一旦开注释，
`#ff0000` 连同整行会被静默吞掉，这条修复也随之消失（行首的 `#` 今天正是
VEL1005「Use '//' for comments」）。行注释没有第二种拼写可让，地板除陷阱就删
不掉——这正是建议这一档存在的理由。实测 `const half = total // 2` 出 A1：
「`'//' is VelarScript's comment spelling, so 'half' receives 'total' and the
rest of this line is a comment; write '(total / 2).floor()' for Python's floor
division`」。

两槽 `for` 的槽位**不改**：`值, 下标` 与 JavaScript 的
`forEach((v, i) => …)` 一致；Python 一侧的正确反射 `enumerate(...)` 本来
就是响亮的错误，不会静默。仅对"下标名在前 + 值名在后"这个 Python 与
JavaScript 都不存在的杂交体出建议。

---

## R1-a 两个 watch 写同一个状态 —— 编译错误

R1 落地后，验收发现它**做不到自己承诺的全部**：写-观察这条轴修好了，写-写
这条轴还在。两个都写同一个状态的 watch 仍按声明顺序执行，实测：

```text
watch t: x = x + 1
watch t: x = x * 10     # → x = 10
```

把两块上下调换，同一个程序得到 `x = 1`。这正是 R1 要终结的那件事。

问题在于**这一条无法靠调度解决**：两个互不相干的写之间不存在"正确顺序"，
任何顺序都是任意的。所以 R1 那句"watch 的声明顺序不可观测"只有在拒绝这种
写法之后才成立。

**裁决（所有者）：两个 watch 写同一个状态是编译错误**，消息点名两个 watch
和它们争的那个状态。这与 R3(c) 是同一个形状、同一个理由——两个互不相干的
来源争同一个东西，胜负无法定义，就让作者自己说清楚，而不是让编译器替他
掷骰子。代价是一种现在合法的写法变成错误，这是接受的。

### 修订（同日，复审 R1-a 时发现）

**这条规则被一次函数提取就绕过。** 实测：

```
watch t: x = x + 1        直接写   → VEL5069, VEL5069   拦住
watch t: x = x * 10

def bump(): x = x + 1     经函数写 → 零诊断，通过      漏掉
watch t: bump()
```

两者语义完全相同，顺序照样可观测。

**最关键的一点：运行时看得见，编译期看不见。** `__velarWatch` 会把体内发生写的
watch 在运行时提升为 writer，`tests/hardening-reactivity.test.ts` 那条测试的
名字就是 "a watch that writes through a helper is classified as a writer"。所以
同一个概念在两处有两套定义——而这正是本次审计反复抓到的缺陷形状。

原先的实现边界（"分析器看不见的写就保守放过"）本意是防误报，但那不是"猜"：
运行时已经算出了准确答案，编译期只是在问一个更弱的问题。

**裁决（所有者）：让编译期对齐运行时**——复用运行时的 writer 判定，至少穿透本
模块内可解析的函数调用。跨模块、经 `any`、经动态派发的写仍然保守放过：那些运行时
自己也只能在执行时才知道。


## R16-a `writes` 可点名导入的响应式绑定（Claude 依 R16 推论裁定,所有者可推翻）

实施 R16 时顶出一个空档:watch 只能经**导入的函数**写到另一个模块的 state,而
`writes` 若只接受本地可赋值绑定,这个今天合法的程序在 R16 下变成**没有合法拼写
可修**的运行时错误——违背 R16 自己的承诺(「运行时是精确兜底」不等于「制造无解
的错误」)。

**裁定**:`writes` 可以点名导入的响应式绑定——`watch t writes hits:`,`hits`
是导入的 state。匹配按**cell 身份**而非名字,跨模块零成本,不引入新概念。

## R1-a-scope 跨模块的 watch 争用——运行时裁判接住（Claude 依 R1-a + R19 裁定,可推翻）

R16-a 让「导入的 cell」可被 `writes` 点名之后,暴露一个空档:**两个不同模块**的
watch 各自声明 `writes hits` 指向同一个导入 cell,两名裁判都放行,一次 flush 里
无序结算。R1-a 的裁决原文没有「限一个模块」——那是实现注释加的界。

**裁定**:按 R19 分层补齐——单模块编译看得见的仍在编译期拦(现状);编译期看不
见的跨模块争用,**运行时在 flush 里两个不同 watch 观察者结算同一 cell 的那一刻**
抛错,点名两个 watch 主语与那个 state,消息形状与现有兜底一致。复用已跨模块的
watch-frame 机制,零编译期成本。

## R1-a-granularity 运行时争用裁判按 watch 实例计（Claude 依 R1-a 推理裁定,可推翻）

跨模块争用的运行时裁判要回答「同一个 watch」按什么算:按**实例**(每次
`__velarWatch` 调用,一个组件级 watch 的两个挂载实例是两个争用者),还是按
**声明**(同一源码 watch 的所有实例算一个)。

**裁定:按实例。** R1-a 的理由本身要求如此——两个互不相干的写之间不存在正确
顺序,而两个实例就是两次互不相干的写;编译期注释也早已承认「两个各写一个模块
state 的组件是两个实例,未必共存,编译器拒绝猜共存性」——运行时正是知道共存性
的那个裁判。代价:一个组件级 watch 的两个共存实例在同一次 flush 里结算同一个
共享 cell,从今天的编译通过变为运行时错误。

## R17-a web 侧 `velar/*` 接口里残留的 `anyType` 位置——随 R20 规范文本一并定

`httpOptionsType.body` 等作者可见位置仍声明 `anyType`。R12/R17/R20 都没有裁到
`velar/*` 接口签名;R20 第 1 条恰好说这些面**现在才**纳入 charter 管辖、规范文本
待写。**本波不动**,随 R20 的规范化一并决定(候选:改 `unknown` 并要求 parse,或
按面逐个声明具体类型)。记录在案,不许静默遗忘。

## R20 `velar/*` 纳入规则 3 管辖;WebSocket 收敛为一套

**现状（根因分析,四视角汇合）**：`velar/*` 目标模块面不在 charter 里,规则 3
在那里没有法律效力。树上还站着的每一个重复拼写都在 `velar/*` 里。两个实测实例:

- **`HttpResponse.ok` 恒真**:`response()` 对任何非 2xx 直接抛
  `HttpResponseError`,能拿到手的响应必然 `ok === true`——但字段还公开着,
  `if not r.ok:` 零诊断零建议,一条死分支,tour 教了两遍。D69 的形状。
- **两套完整的 WebSocket 客户端**且互相矛盾:`velar/websocket.connect`
  (关闭码 1000-4999,类型化 `WebSocketClosedError`)与 `velar/realtime.socket`
  (只认 1000/3000-4999,抛裸 `Error`)。

**裁决（所有者）**:

1. `velar/*` 模块面纳入 charter 管辖——规则 2、3 对它们有法律效力,每个面的
   契约要有规范文本,不再只活在 web-api 散文里。
2. **保留 `velar/websocket`,收掉 `velar/realtime.socket`**。客观标准同 R14:
   专门模块、名字即职责、错误类型化、关闭码范围完整。`velar/realtime`
   保留其余能力,只收 socket 这一个重复面。
3. `HttpResponse.ok` 移除——一个恒真的字段是类型里的一句谎话;诊断教
   `HttpResponseError` 的 catch 路径。

### 实施记录（追记 2026-08-23,只记落点,不改裁决文本）

- 第 3 条已在三个目标落地:Web 报 VEL5075(`web/analyzer.ts`);Node 报
  **VEL6007**——不是 VEL6006,那个号归 CLI 的「JavaScript 包导入不可解析」
  (`cli/src/project.ts`),见 `node/server-analyzer.ts:84-85`;消息与 Web 逐字
  相同,因为 packages/node 不得依赖 packages/web,只能复制。Desktop 复用 Node
  的 `velar/http` 接口(`desktop/compiler.ts:1253`),其运行时在 `response()`
  里问一次且只问一次 2xx,非 2xx 在值到手前抛 `HttpResponseError`。
- 第 2 条已落地:`velar/realtime` 不再导出 `socket`,导入它会被点名答
  「用 velar/websocket 的 connect」(`compiler/src/language-guidance.ts`)。
- R16-a 已实施并验证:匹配按 cell 身份(所属模块 + 导出名),别名折叠为同一
  cell;双路径 re-export 编译期折不动,依 R19 交 flush 里的运行时裁判;
  VEL3002 不受影响,经导入直接赋值仍拒绝。
- R17-a 的 `anyType` 位置原样站着(`httpOptionsType.body` 等),等第 1 条的
  逐面规范文本一并定。

## R21 执行顺序就是书写顺序;R16 整条撤销（裁决：所有者，2026-08-23）

**被推翻的东西不是一条规则，是一句承诺。** charter 此前承诺「watch 声明顺序在输出里
不可观察」，运行时为兑现它专门让「声明了写的 watch 先于纯观察者跑」
（`packages/web/src/runtime-foundation.ts:889-894`）。R1、R1-a、R1-a 修订、R16 四轮
工作全部是在守这一句。

**所有者裁定**：这句承诺本身有问题。**按正常的代码直觉，谁先定义谁先执行。**
两个 watch 写同一个 state 不是错误——按顺序都生效。`total += 1` 写两次就是加两次；
有人写 `total = n` 把前面的覆盖掉，那是他自己写错了，作者负责，编译器只按规则执行。

**后果，逐条：**

1. `writes` 子句删除。VEL5072/5073/5074 三条诊断删除。
2. VEL5069（两个 watch 写同一 state）删除。R1-a、R1-a-scope、R1-a-granularity
   连同它们的两个运行时裁判一并撤销——它们守的那句承诺不存在了。
3. 「写者先于观察者」的调度删除。结算内的执行顺序 = 书写顺序（同模块按源码，
   组件实例按挂载，跨模块按模块初始化）。
4. **「这个 watch 写不写」三处推断不许复活。** 编译期不再分析，发射器不再算
   `produces`，运行时在写发生的那一刻才知道——写了哪个 state 就标脏它、重排它的
   观察者、继续结算。R16 之前那个「三处各自猜且互相矛盾」的状态产出过四条确认缺陷，
   删掉声明之后退回去猜比两者都糟。
5. **R1 的无毛刺保证保留。** 那是「派生值在 DOM 落笔前结算到不动点、只提交一次」，
   与 watch 之间的写顺序是两件事。变的只有后者。
6. charter 那句「声明顺序不可观察」改写为「执行顺序就是书写顺序」。

**不加优先级写法（所有者裁定，2026-08-23）**：一度考虑为跨文件场景补一种可选的
优先级拼写（`runs first` / `runs last`）。所有者裁定**不加**。

理由记下来，免得下次有人再提：那个「修正要先于显示」的场景，正解是把修正写成
`computed`——它天生无毛刺、与执行顺序无关，是 Vel 里表达派生值的唯一拼写。给
watch 加优先级等于给「本该是 computed 的 watch」打补丁，等于在语言里加一个词去
救一种本来就不该那么写的代码。参照：Vue 也没有 watcher 之间的优先级，它的 `flush`
管的是相对 DOM 更新的先后，那是另一个轴，Vel 已有 `@mounted` 与 `tick()`。

**所以本条的全部内容就是一句话：执行顺序就是书写顺序。没有第二条规则。**

## R16 写状态的 watch 必须在头部声明写目标

**现状（根因分析,四个视角独立汇合,全部执行验证）**：watch 体可以写状态,于是
「这个 watch 写不写」被**三处各自推断**——编译器（VEL5069 调用图,
`web/analyzer.ts:1937-2192`）、发射器（`produces` 参数,`web/emitter.ts:777-808`）、
运行时（调度纪元,`web/emitter.ts:1970-1975`）——且三者互相矛盾。charter:3800 那句
加粗的「声明顺序不影响 flush 结果」**实测为假**,三种形状（成员路径、`let` 别名、
`append` 变异方法）都能让上下调换改变结果,零诊断。这个决定已产出四条确认缺陷、
耗掉三轮修复（R1、R1-a、R1-a 修订、b590eae）。

**归属更正（2026-08-23）**：本节原记为「裁决（所有者）」，不实。所有者当时收到的
全部信息是一行「R16（watch 写目标必须在头部声明）」，回复是「开 R16 那批」——那是
**批准开工**，不是批准设计。下面这条规则、`writes` 拼写、以及「不声明即编译错误」
全部由 Claude 定。所有者 2026-08-23 提出反问「为什么要写 writes」，本节处于**待重裁**状态。

**规则（Claude 定，待所有者重裁）**：要写状态的 watch **必须在头部声明它写哪个 state**。
不声明的 watch 是纯观察者,体内出现对状态的写（赋值、复合赋值、变异方法、
经模块内可解析调用抵达的写）即编译错误,消息教出声明拼写。

拼写（Claude 定,所有者可推翻）：`watch t writes x:`——`writes` 为 watch 头部
专用的上下文词,声明多个目标用逗号。选它而不是 `->`（已表示结果类型）。

**消解**：三套推断机械全部坍缩为一个 token 比对;VEL5069 变成声明目标的集合相交;
charter 那句保证按构造成立;R1-a 修订记下的四处沉默（跨模块、`any`、`let`、成员
路径）不再存在——因为没人需要推断了。这与 R15(a) 是同一个动作用在体上:
**把推断换成声明,让语法窄到分析不必强**。

纠正型（`watch n writes n: if n > 5: n = 5`）与累积型（`watch query writes history:`）
两个受祝福的惯用法都保住。迁移:仓库 4 处。

## R17 JS 边界交回 `unknown`,不再是 `any`

**现状**：未声明的外来值进来是 `any`——可赋给一切、无运行时检查。94 处分支专门
护它（compiler analyzer 70 处、web 24 处）,四个操作（f-string、`str()`、条件、
`await`）被迫开例外拒收。R12 已裁「`any` 不得出现在导出位」,但它在模块内畅通。

**裁决（所有者）**：边界交回 `unknown`。未声明的外来值必须先校验成具体类型
（`Type.parse`）才能使用成员——R12 的哲学从出口收到入口。「不写契约就链式调用
外来值」这个能力被有意放弃。

仓库内迁移成本近零:`unsafe js` 全仓 8 处,全在讲 `any` 的教程章
（examples/tour/core/13）,该章随本裁决重写。94 处分支与 4 个例外长期可删。

## R18 异步迭代与同步一致:声明,不是鸭子类型

**现状**：同步迭代要声明（`@iterate:`）,异步迭代靠鸭子类型（任何有
`next() -> Promise<T?>` 的值）。源码注释给的理由是「异步流是资源,问题不可判定」
（`analyzer.ts:5460-5463`）——**实测为假**:普通类不带 `using` 直接进 `async for`
零诊断,所有权从未被问过;而声明了 `@iterate:` 的类在 `async for` 反而被拒。
一个想法两种拼写,声明的那种在鸭子的位置被拒。

**裁决（所有者）**：对齐到声明。`@iterate:` 获得异步形式,类**声明**自己是异步流,
走 `@dispose:` 已有的解析/校验路径。那两条「不可判定」的假注释一并删除。

**语义确认（所有者,实施后追认）**：异步 `@iterate:` 块是**逐次拉取**——块被逐个
驱动、可 `await`、答 `T?`、`null` 即耗尽——正是 `async for` 已经消费的那个契约的
声明式拼写。与同步形式（答一个集合）不对称,但那是真话:流和集合本就是两种答案。

## R19 判定的层级:编译期 → 运行时 → 汇报

**裁决（所有者,把已有实践立为一般原则）**：一个正确性问题,编译期能判的在编译期
判;编译期判不了的（值在运行时才成形）,**运行时在它成形的那一刻判**,失败要响、
要点名;运行时也判不了的,才升级为设计问题向所有者汇报。「编译期判不了」不是
放行的理由——那只是换了裁判,不是取消比赛。

这不是新原则,是把已有实践点名:charter §1.1 的边界类（compile-erased /
runtime-controlled）、R11 只查字面量的理由（「只有字面量的全部键都写在眼前」）、
R5 的运行时校验,走的都是它。

**首个应用——Node 路由重叠**:重叠检查现在对表达式形状（`...prefix("/api", routes)`,
恰是 docs 教的写法）直接放行。此后:(a) 编译期学会保路径的组合子
（`use`/`bodyLimit`/`docs`/`lifecycle` 不改路径,`prefix` 按字面量平移）,能静态判
的尽量静态判;(b) **服务器装配/监听时对最终路由表做同一套重叠判定**——那一刻全表
在手,判定精确,重叠即拒绝启动,消息点名两条路由与它们的来源。运行时兜得住,
所以这条不需要汇报。

## R15 `watch` 的主语，与派生值的唯一拼写

所有者一次裁定，两半，同一个理由。

### (a) 主语收敛为「命名响应式变量，或从它出发的读取路径」

> **`watch` 的主语是一个 `state` 或 `computed` 的名字，或者一条从它出发的读取
> 路径（成员访问、下标）。主语里不许出现运算符，也不许出现调用。**

实测的净变化只有两行——`watch n + m as sum, _:` 与 `watch f():` 从允许变为拒绝。
`watch items[0].done:` **仍然合法**，任意深度、下标是不是常量都不影响：它是**读取
路径**，命名了响应式图里的一个位置；`a + b` 里有运算符，那是**计算**。

要在主语里算东西，先给它一个 `computed` 名字。三种被拒的形状共用同一条出口，
已实测可行：

```velar fragment
computed sum = a + b
computed v = f()
```

**为什么这条比它的体量重要**：本轮审计追了两遍同一个递归——一条关于 watch 的规则
先被 helper 绕过、再被别名绕过、最后停在 `let`。那个递归的**根**是主语可以是任意
表达式，于是「哪个 watch 与哪个 state 相关」只能靠**推断**。主语收敛之后，这层
关系是**声明**出来的。上一轮我判断终止递归要靠更强的语义图分析；这条裁决走了相反
的方向——让语法窄到分析不必那么强——而且它同时让规则**更好解释**。

### (b) 删除 `cached`；`computed` 是派生值的唯一拼写

`cached` 的内部名字字面就是 `reactive.computed`（`packages/web/src/types.ts:64`），
它与 `computed` 是同一个缓存的两种拼写：一个是声明、裸读，一个是值、调用才能读。

**它主动制造问题**：它的类型是 `() -> T`，与任何零参函数**无法区分**，所以编译器
看不出「这是个派生值」。D69 那条「死 watch」正是这么来的（`watch total:` 静默永不
触发），而 (a) 若保留它，就得为它单开一句例外。

**代价实测为零**：仓库 89 处 `cached(` 里，88 处是 `const name = cached(...)`——
一个穿着值外衣的声明；唯一一处值形态 `return cached(...)`
（`tests/compiler.test.ts:7257`）出现在一个测别的东西的用例里，是顺手写的。
跨模块传递本来就走 `export computed`（charter:4717 明写可裸读）。

**缓存能力不丢**：`computed` 本来就缓存——charter:3646「its result is evaluated on
first access and cached while observed」。删掉的只是第二种拼写，不是那个能力。

规则 3（一个想法一种拼写）在这里既是理由也是收益。

## R14 `HttpError` 改名消歧（Claude 裁定，所有者可推翻）

Node 面上有**两个都叫 `HttpError` 的类**：`velar/http` 的客户端失败
（`http-runtime.ts:403`，带 message/status/url/body）和 `velar/serve` 的出站
失败（`serve-runtime.ts:419`，带 status/body/headers）。两者注册在不同身份下
（`velar/http#class:HttpError` 与 `velar/serve#class:HttpError`）。

同时导入两个裸名会被拒（VEL3004——这恰好证明身份是不同的），**但导入其中一个、
用 `is` 去测另一个的实例，编译干净且永远为假**。代理路由正是同时碰到两者的
典型形状。

**裁决**：`velar/http` 的那个改名为 `HttpResponseError`；`velar/serve` 的
`HttpError` 保持不变。

选哪个改名有客观依据，不是口味：`velar/serve` 的 `HttpError` 是作者**会写**的
那个（`throw HttpError(502, {...})`，`docs/ai-skill-node.md` 的路由示例教的
也是它），而 `velar/http` 的那个只会被**接住**——名字被读得多、被敲得少，改它
的肌肉记忆成本最低。`HttpResponseError` 也更说得清它是什么（一个非 2xx 的
响应），并且与同模块已有的 `HttpAbortError` 并排自然。

## R13 源码包必须能声明它所需的语言代际

**现状**：发布到 npm 的 Vel **源码包**（`files` 里是 `.vel` 而非编译产物）
无法声明它是被哪一代语言编译的。`packageRequiredCapabilities`
（`packages/cli/src/project.ts`）把清单模式关死，除 `capabilities` 外的任何
字段都会抛错，所以今天连"加一个字段"都不成立。

后果与"永不承诺兼容"直接冲突：语言一变，旧包的 `.vel` 会报出一串**看不懂的
普通编译错误**，看上去像是这个包写错了，而不是"它属于上一代"。

**裁决（所有者）**：包清单的 `velar` 段增加一个**可选的语言版本区间**，在编译
该包的 `.vel` 之前检查。不匹配时报一条点名的错误——"这个包声明需要语言
0.11，当前是 0.13"——而不是让作者从一堆语法错误里自己猜。

理由与 [D89](D89-ADVISORY-CHANNEL.md) 里加建议通道的理由同源：**"永不承诺
兼容"这个机制，只有在破坏是响的、并且说得出破坏原因时才安全。** 今天的破坏
是哑的，而且伪装成了别人的 bug——这是这个机制最怕的形态。

字段可选：不声明的包保持今天的行为，不产生新的门槛。

## R11 带标注位置上的记录字面量是封闭的

**现状**：`type Options: retry: number, timeout: number?` 配上
`const o: Options = {retry: 1, timeoutMs: 30}` 得到**零诊断**——`timeoutMs`
被静默丢弃，`timeout` 永远是空。只有必需字段的变体
（`{retry: 1, extra: 2}` 对 `type Options: retry: number`）同样零诊断。

**裁决（所有者）**：写在带类型标注位置上的**字面量**是封闭的——出现类型里
没有的键即报错，并提示最接近的那个字段名（`uniqueNearestName` 那张表编译器
已经有了，复用它，不要另建）。**非字面量的值不受影响**，保持今天的结构化
开放：本裁决只针对字面量，因为只有字面量的全部键都写在眼前，编译器才能确定
作者不是在传一个恰好更宽的值。

理由：拼错字段名是模型最常犯的错误之一，而它今天完全静默——正是定位要消灭
的那一类。

## R12 `any` 不得出现在导出位置

**现状**：显式写 `export const leaked: any = thing` **已经被拒绝**
（"'any' is reserved for explicit unsafe JavaScript boundaries"），但**推断**
出来的 `export const leaked = thing`（thing 来自 `unsafe js` 块）畅通无阻：
`moduleInterface.exports` 列出了 `leaked`，消费模块从不写 `unsafe`，却丢掉
全部保证。

**裁决（所有者）**：不管显式还是推断，`any` 都不能出现在导出位置；要导出，
先在本模块内把它校验成具体类型。

这不是新规则，是把已有规则补齐。今天的行为是"写出来就拒、不写就放行"，
本身就是个漏洞：**被拒的那种写法反而是诚实的那种**。不引入"传染性不安全
标记"这个新概念，规则 3 得以保持。

## R9 前导点续行：缩进从「规范」变为「必需」（Claude 裁定，所有者可推翻）

charter:107-111 说「只存在一种续行形式：首个 token 是 `.` 或 `?.` 的行续接
上一逻辑行」，并把更深的缩进称为**规范写法**而非要求。实现比这松得多：它会
跨越任意多的空行、注释行乃至**反缩进**去续接，于是一个反缩进的 `.sorted()`
会静默接到词法器能够到的任何值上。

**裁决**：两个条件都变成必需——续行必须紧跟被续接的那一行，且必须缩进到它
之后；违反是 `VEL1004`。

这不改变任何东西的含义，只是把 charter 已经写明的"唯一一种续行形式"真正
强制起来。一个反缩进的 `.sorted()` 本来就没有任何有意义的解释，所以它也不
属于 [D89](D89-ADVISORY-CHANNEL.md) 的建议通道——那一档留给「Vel 接受了但
含义不同」的拼写，而不是「根本没有含义」的拼写。

影响面实测为零：仓库 `examples/` 与 `docs/` 下 66 个 `.vel` 文件产生 0 条
VEL1004，`check-velar-format` 在 90 个源加 25 个模板上全绿，
`check-documentation-examples` 232 个示例通过；格式化器本身按
`(statementLevel + 1) * indentWidth` 输出续行，永远满足新规则，所以
「格式化后再编译」的往返成立。文档波补写 charter:107-111 的规范文本。

## R10 视觉块的开启位置：与 JSX 共用一条规则（Claude 裁定，所有者可推翻）

`visualBlockKeyword` 从不检查标识符**之前**的那个 token，于是前面的 `dot`
是不可见的，`case Mode.look:` 被当成 Look 块的开头——在 Web 模块里编译失败，
而同一份源码在 Core 里干净通过。实测同类还有 `case Mode.keyframes:`、
`if m == Mode.look:`、`else if m == Mode.look:`、`while m == Mode.look:`。

**裁决**：`look:` / `keyframes:` 只在**可以开始一个值**的位置开启——与 `<`
开启 JSX 的位置**同一条规则、同一张表**（charter §14 已有的
value-start 列表：模块开头、换行、缩进，以及 `=`、`return`、`=>`、`(`、`[`、
`{`、`,`、`:`、`?`、`??`、`and`、`or` 之后）。

为什么共用而不是给视觉块另立一张表：另立一张表就是同一个想法的第二种拼写，
正是规则 3 禁止的；而"只把 `dot` 排除掉"是这次波专门要避免的"只修被点名的
那个例子"。共用之后，作者学一条规则管两个构造。

**同批发现的假引用**：`packages/web/src/lexer.ts` 那张表上方的注释声称
"The list is published in charter §14 (GRM-A3)"。这是假的——全仓
`grep -n "GRM-"` 在 charter 里零命中，唯一的 GRM-A3 在
`docs/decisions/archive/COMPLETENESS-AUDITS.md:846`，是一条**从未完成的
计划项**（原文正是"charter §14 发布判定规则"）。这条注释早于本次审计，但
R10 让这张表同时承载第二个构造，所以文档波必须真的把它发布出来，并把注释里
的 `(GRM-A3)` 换成对 §14 的普通引用。

## R4 的两条推论（实施波顶上来，由 Claude 裁定，所有者可推翻）

实施 R1/R4 时冒出两处"用户看得见的行为"要定，它们都不是新问题，而是同一条
原则在别处的推论：**响应式状态变了就更新**。据此裁定：

**R4-a `Head` 改为活属性（live props）。** 今天 `Head`、`Link`、`NavLink`、
`Router` 都把 props 快照一次，且那条本可发现问题的"读冻结值"告警在这条路径上
被显式静音了（charter:3095-3097 与 web-api.md:953-955 确实把快照写成了既定
行为）。但 `<Head title={f"Inbox ({unread})"} />` 正是作者会写的形状，也正是
会静默腐烂的形状，而 `Head` 没有任何身份或生命周期上的理由需要冻结——它只是
校验记录形状，而校验完全可以每次更新时再跑。

**修订（同日，复审时推翻上一句的后半）：四个组件全部改为活属性。** 原裁决只改
`Head`、让 `Router`/`Link`/`NavLink` 继续快照，结果是四个并排的框架组件有两种
行为，作者必须记住是哪一个——这恰恰是「一个想法一种拼写」要消灭的东西，而它是
为了修一个具体问题顺手造出来的。

一条规则即可：**响应式状态变了就更新**，与 R4 对 `children` 的裁定同源。
`<Link to={path}>` 里 `path` 是 state 时本就该跟着变；路由表通常是常量，改活之后
不会有任何东西重算。charter 相应各处由文档波改写。

**R4-b 属性表达式：构造时求值一次，之后按需重算。**（本条裁定的模块级实例化点
`const root = <App />` 依然合法、依然急切、依然按书写顺序；D109 只改它的**失败
方式**——构造抛出不再逃出模块求值留下白屏，而是走 `mount` 已有的致命态机制。）
今天每个 prop 都挂一个
急切的 DOM 观察者推 `cell.set(read())`，所以 `<Child unused={heavy(n)} />` 里
`heavy()` 永远在跑，哪怕 `Child` 从不读 `unused`（1000 行 × 8 个 prop = 8000 个
观察者在任一依赖变动时全部重跑）。裁定：**构造时仍按 charter:2906-2908 的
左到右顺序急切求值一次**，保住那条已写明的规则和任何构造期副作用；此后改为
按读取重算并在被观察期间缓存。纯改成惰性会连构造期的第一次求值也推迟，那才是
真的改语义；这个折中不改变任何已写明的规则，只去掉无界的每次更新开销。

### 修订（文档波复审时发现前提为假）

**上一段"保住那条已写明的规则"是错的——那条规则从来就不成立。**
charter:3140 写着「Component JSX follows JavaScript evaluation order: props
evaluate from left to right, then JSX children, then the component function」，
三个分句全是假的。实测编译 `<Child second={b()} first={a()} />` 配
`component Child(first, second)`：

- 调用处发出 `{ second: () => (b()), first: () => (a()) }`——**每个 prop 都是
  thunk，一个都没求值**；
- 组件体里先发 `__velarRequiredProp(__velarProps, "first", …)` 再发 `"second"`。

所以实际是**按被调用者的参数顺序、在组件函数内部**求值，`children` 落在它所占
的参数位而不是所有 prop 之后。快照分支（`emitter.ts:3208-3221`）却**按书写顺序**
求值，于是两种形状彼此不一致。

**裁决（所有者）：改实现，恢复书写顺序。** 构造时在调用处按调用者写下的顺序把
thunk 强制求值一次，然后再进组件函数。这本来就是 R4-b 裁定的内容（构造时急切
求值一次、之后按需重算），只是实现漏掉了顺序那一半；charter:3140 无需改动，它
描述的正是应有的行为。而且这是一个写 JSX 的人会预期的行为——JavaScript 的对象
字面量本来就按书写顺序求值。

**但 `children` 是例外，charter:3142 那一句要改**（Claude 更正：我先前说
"charter 无需改动"只对 props 那一句成立）。让「then JSX children」变真意味着
构造时急切地把 children 也建出来，而这与 **R4** 直接冲突——R4 裁定 children 是
「由展示它的那个位置拥有的渲染内容」，`false` 就是不渲染。急切构建会让一个藏在
条件后面的 slot 白建一次，也会让一个从不使用该 slot 的组件跑掉它的副作用。

R4 是所有者对 children 深思过的裁定，charter:3142 那半句只是从 JavaScript 借来的
求值顺序描述。**R4 胜出**：props 按书写顺序、构造时一次；children 走 R4 的路径，
由展示它的位置在渲染时构建、再次渲染时重建。charter:3142 已按此改写。

## 移出仓库的生态树

D88 把 `adapters/*`、`libraries/*`、`integrations/*` 移出本仓库。审计在那些树里
确认的缺陷共 22 条，归属如下（本节曾记为「一并放弃」，在得知代码去向后更正）：

- **compression、msgpack、noise、text-buffer** 已迁入独立仓
  `VelarScript-Libraries`。逐字节比对确认迁移后的 `src/index.vel` 与被删时**完全
  相同**，因此审计结论、行号与复现步骤全部直接适用。落在它们身上的 **10 条**已在
  那个仓库处理，其中包括 compression 的解压炸弹和 text-buffer 的两条偏移量失配。
- **sqlite、database、script-analysis** 至今没有落脚点。它们的 **12 条**记录在
  [D88 附录](D88-APPENDIX-MOVED-CODE-FINDINGS.md)，作为这些实现重建时的用例清单。
  最重的是 SQLite 连接在自动回滚或流消费之后永久卡死。

代码可从 `aa4723a` 取回。审计结论不随代码作废，只是换了归属。

## R22 不为不存在的用户保留迁移诊断（裁决：所有者，2026-08-23）

**事实**：本项目从未发布到 npm，**目前没有旧版本的使用者**。所有「教旧版本迁移」
的诊断都是在为不存在的人服务,全部删掉,干净断开。

**判据（唯一一条，删与留都按它判）**：这条诊断教的是「Vel 从前有、现在没了」，
还是「别的语言有、Vel 没有」——**前者删，后者留**。前者服务的是不存在的旧版本
用户；后者服务的是从别的语言/框架来的新人，那批人是真实存在的。

### 删掉的五组

1. **`HttpError` → `HttpResponseError`**（`packages/compiler/src/language-guidance.ts`
   的 `velar/http` 迁移条目）。`import {HttpError} from "velar/http"` 现在报
   `Module 'velar/http' has no export named 'HttpError'`。
   `velar/serve` 的 `HttpError` 类本身是活的（它是路由抛出的对外失败），只删这条提示。
2. **`velar/realtime.socket` → `velar/websocket.connect`**（同一文件的 `velar/realtime`
   迁移条目）。现在报 `Module 'velar/realtime' has no export named 'socket'`。
   随之 `removedStandardFunctionGuidanceEntries` 只剩 `velar/text` 与 `velar/math`
   两族——那两族教的是「Python/JS 有这个函数、Vel 把它做成了成员」，是「别的语言有」，保留。
3. **退役字段 `HttpResponse.ok` 的教学**：Web 的 `VEL5075`、Node 的 `VEL6007`、
   两侧的常量 `RETIRED_HTTP_RESPONSE_OK`，以及只为它存在的辅助
   （`isHttpResponseObject`、`retiredFieldReceiver`、`retiredResponseFieldWrite`、
   `teachRetiredResponseDestructure`、`receiverInferableBeforeMember`、`speculativeType`），
   连同为它们导出的 `webHttpResponseType` / `nodeHttpResponseObjectType`。
   读、写、解构三条路径现在都得到普通的 `VEL4001 Object has no field 'ok'`，那是正确答案。
   **宿主边界上的 wire-level `ok` 校验（desktop/node 的 `responseOf`、`hostResponse`）
   是完整性检查，保留。**
4. **`writes` 旧拼写教学**：`VEL5076`，以及 `packages/web/src/parser.ts` 里为识别
   这个旧拼写而存在的形状识别（`rejectWatchWritesClause`）。`writes` 现在是普通标识符，
   `watch t writes x:` 按普通语法报错（`VEL2001 Expected ':' before an indented block`
   起头的一串），R21 已裁定这就够了。
5. **`cached` 的退役教学**：`isRetiredAccessorName` 不再认 `cached`，`VEL5055` 的
   `'cached' is removed: ...` 分支删除。`cached(...)` 现在是 `VEL3001 Unknown name 'cached'`，
   那是正确答案。

### 判为「保留」的

- **charter 第 3 节那族「刻意不存在的源码特性」**（`onMount` → `@mounted:`、
  `effect` → `watch`、Python/React 习惯的 A1–A6 建议等）服务的是从别的语言/框架来的
  新人，**全部保留**。
- **`computed(...)` 的函数形式（`VEL5055`）保留。** 按判据它是「别的语言有、Vel 没有」：
  Vue 3 与 signals 系库都写 `computed(() => ...)`，这是新人的习惯而不是旧版本的遗物；
  而且 `computed` 是活的声明关键字，删掉这条会让 `computed(...)` 掉进语法级联而不是
  一条清楚的答案。`cached` 没有任何别的语言写，所以它是纯粹的旧版本遗物，删。
  这一条与本节其余四条的差别就在判据的两侧，记在这里免得下次有人把它们当成一类。
- `velar/serve` 的 `HttpError` 类、宿主边界的 wire-level `ok` 校验、R21 其余部分。
