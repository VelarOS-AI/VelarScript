# D32 — 第四轮语法排查：强转洞、浮动 Promise、混用括号（已批准，待实施）

用户于 2026-08-12 批准三条修复；fire-and-forget 出口经用户驳回 `background()`
包裹函数（「包一个 background 有些麻烦」）后改为 **`async` 语句**。判据同
D28-D31。所有现状结论均由真编译器探针验证。

---

## 第 29 条 —— f-string 与 `str()` 收紧到转换白名单（缺陷族）

### 现状（实测，三层递进）

```
print(f"user: {user}")        → user: [object Object]      记录经 JS 强转
print(f"list: {[1, 2, 3]}")   → list: 1,2,3                隐式 Array.toString
const sneaky = {toString: () => "HOOK-INVOKED"}
print(f"value: {sneaky}")     → value: HOOK-INVOKED         自有 toString 字段被执行
print(str(sneaky))            → HOOK-INVOKED                str() 同样中招
```

第三层是性质变化：**记录的 `toString` 数据字段被字符串强转隐式执行** —— 直接违反
charter 反复成文的钩子禁令（"normalization never calls their conversion hooks"、
JSX 的 "never calls an object's conversion hooks to invent text"）。硬化波
W-79~W-96 关闭了运行时各处的钩子面，但正门的 f-string 与 `str()` 是开的。
JSX children 位守住了该契约（对象被拒），同一个值放进 f-string 却放行。

### 目标语义

- **白名单**：f-string 插值位与 `str()` 实参只接受 `string`、`number`、`bool`、
  枚举、`null`，及其 optional 与全臂白名单的联合。其余 —— 记录、`List`/`Map`/
  `Set`/`Record`、函数、类实例、`unknown`、`any` —— 编译期拒绝。
- **与 JSX children 同一契约**：charter §14 的转换规则从「JSX 的规则」升格为
  「语言的文本转换契约」，f-string、`str()`、JSX 三处引用同一段成文。
- `any` 一并拒绝：unsafe 域正是 toString 钩子藏身处，与 W-79~96 的方向一致。
- **诊断教两个出口**（均已实测存在）：检查值用 `print(value)`（宿主 console
  漂亮打印 `{ id: 1, name: 'Ada' }`）；造文本用 `stringify(value)`（velar/json
  现成）或读取具体字段。示例文案：
  `An f-string renders strings, numbers, bools, enums, and null; format User
  explicitly — print(value) to inspect it, stringify(value) for data text`。
- **发射不变，不加运行时守卫**：白名单类型的模板串强转安全（checked string 即
  string、bool → "true"/"false"、枚举运行时值本就是字符串、null → "null"）。
  静态白名单堵死后唯一逃逸是 extern 谎报类型，而 extern 本就是可信 ABI 契约
  （charter §12 成文），与既有信任模型一致。
- `Infinity`/`NaN` 照打（日志要诚实）；JSX 的 finite-only 运行时约束不变 ——
  UI 与日志是两个界，白名单（编译期类型）相同、运行时约束各自保留。
- Web 扩展单位值（`Length` 等）v1 拒绝；留扩展 opt-in 钩子作后续，避免 v1 面扩大。
- 迁移：门禁找出所有非白名单插值站点；每一处都是现状下的垃圾输出或钩子风险，
  属本条要暴露的真问题。

---

## 第 30 条 —— 浮动 Promise 编译期拦截 + `async` 语句（缺陷族）

### 现状（实测）

```
async def boom() -> null:
    throw Error("background failure")

boom()                  // 编译零诊断
print("after the call") // 打印后进程死于裸 unhandled rejection
```

「编译干净、运行裸崩」家族成员。TS 生态 no-floating-promises 是最常开的严格
lint，佐证这是 JS 头号异步笔误。

### 目标语义

1. **拦截**：静态类型为 `Promise<T>`（含携带 Promise 的 optional/联合）的
   **表达式语句** → 编译错误。诊断教两个拼写：
   `This call returns Promise<null>; 'await boom()' to wait for it, or
   'async boom()' to run it detached`。
2. **出口是 `async` 语句**（用户裁决，取代被驳回的 `background()` 包裹）：

   ```
   await save()     // 等它
   async save()     // 明确不等：分离执行，失败有主
   ```

   - **对称即教学**：`await` = 等，`async` = 不等。复用既有关键字，零新词、
     零导入、六个字符。
   - 语法：语句头 `async` 现有 def / for 两分支，新增表达式分支
     `async <expression>`；表达式的检查类型必须是 **`Promise<null>`**。
   - **结果会丢的任务不许分离**：`async loadUser(id)`（`Promise<User>`）→
     错误 `The result would be lost; await it, or discard it explicitly in an
     async def`。丢弃永远是显式动作。
   - **失败路径有主**：发射器把 `async expr` 包进编译器自有 helper —— 观察
     rejection，归一化为 `Error`，走宿主错误通道（Node：stderr 报告，**不崩
     进程**；Web：velar/app 错误链，独立 detached 阶段标记），永不静默。
   - 组件内 UI 异步仍归 `action`（组件生命周期所有、pending/error 面）；
     `async` 语句是进程/页面生命周期。charter §7 async 段落与 web-api 写明分工。
3. **作用域纪律（v1）**：只管表达式语句位。存进绑定的 Promise 不追 ——
   「存了没等」需要逃逸分析，D1/D2 已裁决不做全程序分析；记入对抗搜捕维度，
   等真实证据再议。
4. **为什么不做「裸调用合法化 + 自动接管」**（零仪式方案，已评估驳回）：那会把
   忘写 `await` 这个最常见笔误静默合法化 —— `save()` 后紧跟读取保存结果的代码，
   时序 bug 无声出现。六个字符买回这层保护。
5. 与 D30 第 17 条组合后，表达式语句的合法集合一句话：**非 Promise 的调用族 +
   `await` 表达式 + `async` 语句**。

---

## 第 31 条 —— `??` 与 `and`/`or` 混用必须括号

### 现状（实测）

```
const r = false or null ?? true   // 静默分组为 (false or null) ?? true
```

Vel 静默定了「`or` 比 `??` 紧」；两种分组在 `false` 参与时语义分叉（真值表已验）。
JS 把 `||`/`&&` 与 `??` 的无括号混用直接定为 SyntaxError —— 两个亲代语言的用户
在此都没有可依赖的直觉。

### 目标语义

- 同一条未加括号的二元链中 `??` 与 `and`/`or` 相邻（两个方向：`a or b ?? c`、
  `a ?? b and c`）→ 解析器定向诊断：
  `Parenthesize the mix of '??' and 'or'; the two groupings read differently`。
- 纯 `??` 链、纯 `and`/`or` 链不受影响。
- 实现：二元解析循环中，当前运算符与左操作数节点分属两族且左节点未经括号 →
  命中。需要 AST 最小的「经括号」标记（查现有 formatter 的括号保留机制，沿用
  其表示）。
- charter §4 优先级表（D30 第 19 条已排）加一行注明混用需括号。

---

## 批次编排

三条全并入**批次 H**，H 升格为「第 3-4 轮缺陷波」：

- D31 第 23 条（模块初始化环）
- 本文第 29 条（f-string/str 白名单）
- 本文第 30 条（浮动 Promise + `async` 语句，语法与发射器 helper 同批落地 ——
  没有出口就没有合法拼写）
- 本文第 31 条（混用括号）

仍排在空值拼写返工波提交之后、批次 A 之前。三道门禁不变；H 结束后对抗搜捕
新增「异步笔误」与「强转垃圾输出」两个语料维度。

## 新增回归（永久）

- 记录/List/自有 toString 字段在 f-string 与 `str()` 中均被编译期拒绝且诊断教
  两个出口；白名单类型（含 optional、枚举、Infinity/NaN 数字）照常工作（执行级）。
- 裸 `boom()` 语句被拦截；`await boom()` 与 `async boom()` 均合法；
  `async loadUser(id)`（非 null resolved）被拒；detached 失败走归一化报告且
  进程不死（执行级，Node 与浏览器各一）。
- `false or null ?? true` 及反向混用被诊断；加括号后两种分组均合法且语义符合
  括号（执行级真值表）。
