# D35 — 并行异步拼写 + 标准库常驻命名空间（已批准方向，待实施）

用户于 2026-08-12 裁定两个问题必须解决：①「并行异步没有好拼写」（驳回了
「只教惯用法」的保守建议）；②「许多函数没有命名空间，需要导入才能使用」。
判据同 D28-D34。

---

## 第 35 条 —— `all` 接受记录：并行异步的好拼写

### 现状（实测）

```
const [name, count] = await all([loadName(), loadCount()])
→ VEL4001: Expected a List of Promises, received List<Promise<string> | Promise<number>>
```

异构 Promise 被 `all` 与 `race` 直接拒绝，报错读来自相矛盾（「我给的就是一列
Promise」）。根因是无元组决策：`List<T>` 无法携带逐位置类型。手写
bind-then-await 可用但无并发标记，AI/读者容易退化成顺序 await。

### 目标语义

1. **`all(记录)` → `Promise<记录>`**（新增，成为并行聚合的规范拼写；与第 36
   条同批落地后，规范书写即 `Promise.all`）：

   ```velar fragment
   const {name, count} = await Promise.all({name: loadName(), count: loadCount()})
   ```

   - 实参为结构记录字面量或记录类型值，每字段类型 `Promise<T_i>`；结果类型为
     同名字段的 `{field: T_i}` 记录。逐字段类型是记录的原生能力，零元组机制。
   - 实现走 compiler-known 函数先例（charter 的 `Type<T>` 载体同款）：analyzer
     对 `all` 的记录实参做逐字段解包推断；发射为对象字段的 `Promise.all` 组装
     （受控记录构造契约：own data 字段、求值一次、不触 accessor）。
   - 拒绝语义沿用 all 现契约：任一 rejection 即整体 rejection。
   - 空记录 `all({})` → 直接解析为空记录（边界一致性）。
2. **`all(List<Promise<T>>)` 同构形态保留**（动态数量场景）。混合列表的诊断
   改为教学：`Mixed result types need named fields; use
   Promise.all({name: loadName(), count: loadCount()})`。
3. **`race` 放宽**：接受混合 Promise 列表，结果为解析值类型的联合 ——
   「谁先回来」的诚实语义。`race(List<Promise<A> | Promise<B>>) -> Promise<A | B>`。
4. 典章 §8（集合/异步节）与 charter velar/async 契约同步：并行聚合的规范拼写
   是 `all(记录)`；bind-then-await 作为手动控制流依然合法，不作为聚合教学拼写。
5. 回归：记录形态逐字段类型（编译 + 执行）、空记录、rejection 传播、List 形态
   不回归、混合 List 诊断文案、`race` 联合结果收窄可用。

---

## 第 36 条 —— 标准库常驻命名空间：能算的不用导，能碰外界的必须导

### 现状与根因

纯计算函数（`stringify`、`range`、`all`、look 构建器）全部要具名导入；盲测
头号 D 项即裸 `range`（写者不知道去哪导）。痛点是导入仪式 + 可发现性。
JS 亲代的肌肉记忆是现成解法：`JSON.stringify`、`Math.max` 免导入带命名空间。

### 目标语义 —— 一句法律

> **能算的不用导（常驻命名空间），能碰外界的必须导（import 行即能力审计信号）。**

1. **常驻命名空间（零导入），大写开头且零发明**（用户 2026-08-12 两次裁决：
   「命名空间用大写开头」+ 指出 `Async`/`Text` 与 `String`/`Promise`/`Object`/
   `Array` 的混淆风险 + 「不能为了兼容破坏 vel 自身的统一」）。法律两条：
   **名字来源零发明**（要么源自 JS 全局、要么挂在既有 Vel 类型上），
   **拼写统一到 Vel 的 PascalCase**（**Vel 自身统一 > 亲代兼容** —— `===`→`==`
   的既有先例：JS 原拼写是指引输入，不是第二拼写）。最终 roster 三个：
   - **`Json.`** —— parse / stringify（velar/json 全量）。源自 JS 全局 `JSON`，
     拼写归一为 PascalCase；`JSON.stringify` → 定向指引
     `Use 'Json.stringify'`，一轮自愈。（此处曾短暂定为全大写 `JSON.`，用户
     以统一性裁决推翻 —— 记录在案防复议。）
   - **`Promise.`** —— all / race / sleep / timeout / retry / map / series
     （velar/async 全量）挂在既有 `Promise` 类型上。`Promise.all` 正中 JS 最强
     肌肉记忆；`Promise.map` 有 Bluebird 先例。charter 原句「shorthand 拼写只
     存在于类型位」更新为「类型位 + 载体成员；构造函数仍不可调用」。
   - **`Look.`** —— rgb / rgba / hsl / alpha / border / shadow / spacing /
     tracks / minmax / repeat / clamp / transition / linearGradient / asset
     等构建器（Web 扩展注册），挂在既有 `Look` 类型上。
   - **`Text.` 不设立** —— 消除「方法还是命名空间」二选一困境：velar/text 存留
     的模块级函数（truncate、normalizeWhitespace、utf8Size、findMatch）**全部
     方法化归 string**（L1 方向走完），velar/text 随之清空退役。
   - 实施者以模块注册表为准复核 roster 完备性，纯计算判据：不触宿主能力、无 I/O。
   - 类型/载体同名共存（Promise、Look）：类型位/值位由语境区分，回归需覆盖
     同文件混用（含 `Promise<T>` 注解与 `Promise.all` 同行出现）。
   - **JS 全局肌肉记忆指引族**（一并实施）：`JSON.` → `Json.`；`Object.keys`
     → 记录字段直读或 `Record<T>` 的 `keys()`；`Array.from`/`Array.isArray` →
     List 构造与 `is List<...>`；`Number.isInteger(x)` → `x.isInteger()`
     （D29 10b）；`Math.` 成员 → 对应数字方法（L1 裁决维持）；`String(x)` →
     `str(x)`。全部进 AI 简报易错表。
2. **能力模块保持显式导入**：fs、process、env、serve、http、host、terminal、
   storage、browser、files、realtime、config、app、web、web-test —— import 行
   就是「本模块碰什么外界」的审计面，直接支撑 D34-A3 能力安全叙事。**不得**
   为便利把能力模块并入常驻。
3. **微型平层 prelude 扩充**：`range` 加入（与 `print`、`str` 并列）——
   Python 亲代裸 range 肌肉记忆 + 盲测头号 D 项就地消灭。prelude 保持极小，
   新增成员需单独裁决。
4. **无新保留字**：常驻命名空间是普通绑定语义、走普通词法查找（charter 既有
   先例「a local or imported color naturally wins」）。用户绑定 `json` 在其
   作用域内自然遮蔽命名空间 —— 不重演 D30 保留字过宽问题。
5. **一个拼写**：纯计算模块的具名导入退役 —— 定向指引
   `Use Json.stringify directly; velar's pure namespaces need no import`。
   能力模块与用户/第三方模块的导入语法不变。
6. **迁移**：examples、Lite、packages 内 .vel、文档全量；门禁为准。AI Skill
   （D33）同步：一句法律 + roster 表进简报。
7. 回归：三个命名空间的成员访问（编译 + 执行）、遮蔽（局部同名绑定胜出）、
   能力模块仍需导入、纯计算导入得到指引、`Promise<T>` 类型位与 `Promise.all`
   值位同文件共存、`Look.` 与 `look:` 块共存、四个 string 新方法（含码点语义
   与 utf8Size 的既有契约不变）、JS 全局指引族逐条命中（含 `JSON.` → `Json.`）。

### 开放子决策（实施前敲定，不阻塞方向）

- velar/collections 除 `range` 外的存留函数（flatten、chunks 等）归属：
  **方法化归 List**（与 Text 的处理同一方向，`List` 类型载体如需静态成员另
  单独裁决）；enumerate 已被双槽 for 取代，直接退役给指引。
- `time.`/`math.` 等已被 L1 方法化清空的命名空间**不回潮**（D17 裁决维持）。

---

## 批次编排

两条同批（都动 analyzer + 标准库面 + 全量迁移）：**批次 K**，排 **A 之后、
E/F 之前**（全局序：H → J → A → K → E/F → I+B → G → C/D）。第 35 条依赖
compiler-known 推断；第 36 条对 D30 软关键字**无依赖**（`Look` 大写载体与
小写 `look:` 块关键字天然分离 —— 零发明 roster 的附带红利）。

每批次三道门禁；K 结束后 AI Skill 按 D33 维护规则同步更新。
