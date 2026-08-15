# D39 — 第九轮（生成性评审）：using、try 表达式、时长、test 块（已批准，待实施）

用户于 2026-08-12 全部批准（第九轮换思路：不挖缺陷，评「设计平庸处与值得加的
语法」）。判据同 D28-D38；新语法遵循 charter 语法白名单纪律（语言决定 + AST +
分析 + 降级 + 证明测试五件套）。

---

## 第 50 条 —— `using` 资源绑定（归新批次 M）

### 证据与先例

Node/Desktop 能力面全是句柄（Process/Terminal/Server/流）；Lite 为进程生命
周期修了 W-118/119/120；charter async-for 节自认「caller remains responsible,
normally with try/finally」。**JS 母亲正在原生加 `using`**（显式资源管理）——
行为问母亲，母亲已点头。与「循环不发明资源所有权」不冲突：那条反对隐式钩子，
`using` 是显式所有权拼写。

### 目标语义

```
using session = openTerminal(columns=80, rows=24)
```

- 语句形：`using name = expression`，绑定不可重赋（const 语义）。上下文关键字
  （语句头 + 标识符 + `=` 形态；D30 消歧原则），零新保留字。
- **释放契约**：值必须带 `close() -> null` 或 `close() -> Promise<null>` 成员。
  作用域退出（正常/throw/return/break/continue）按**声明逆序**调用；异步 close
  在非 async 语境 → 编译错误「async disposal needs an async context」。
- 获取异步照常写 `using proc = await start(...)`（await 在初始化器）。
- **释放失败不吞不盖**：有在途错误时原错误优先、close 失败归一化后走宿主报告
  通道（与 finally 哲学一致）；无在途错误时 close 失败正常抛出。
- stdlib 对齐调查（实施项）：Terminal.close ✓；Server/流句柄对齐 `close()`；
  Process 的 `stop()`（信号升级语义）是否等同 close 由实施者调查后单独呈报，
  不预设。
- charter 新节成文；回归含执行级 LIFO、throw 路径、async close、双 using。

## 第 51 条 —— `try` 表达式：尝试即可选（归批次 M）

### 证据

Lite 手写 `tryParse`；`parsePostMessageBody` 的 try/catch-返 null 形态写两遍、
被调用方再 catch 两遍。「预期失败」在 Vel 世界观里本就是 optional（`.get()`
哲学）；Swift `try?` 先例。复用既有 `try` 关键字，零新词。

### 目标语义

```
const user = try User.parse(untrusted)     // User? —— 失败即 null
```

- 表达式前缀形：`try <postfix-expression>`，捕获范围同 `await`（整条后缀链）。
  求值中任何抛出的 `Error` → 结果 `null`；类型 `T` → `T?`（T 已 optional 则
  保持，失败与 null 合流成文）。
- `try await load()` 合法（捕获 rejection → `T?`）。
- **结果必须被消费**：try 表达式作裸表达式语句 → 编译错误（那是无可见消费的
  静默吞错）；要故意忽略失败写 try/catch。嵌套 `try try` 拒绝。
- 与解析歧义：语句头 `try` 后跟 `:` 是既有块；后跟表达式且行内无 `:` 块形 →
  表达式形（作为初始化器/实参等消费位出现，天然无歧义）。
- 失败详情不丢承诺不变：要详情的场景照旧 try/catch；`try` 是显式吞、使用处
  可见，与 `?? fallback` 同道德地位。

## 第 52 条 —— 时长进时间 API：`sleep(2s)`（归批次 K）

- `ms`/`s` 两个后缀与 `Duration` 类型**提升为 Core**（现由 web 扩展注册 ——
  第二轮实测 Core 不认后缀；其余单位仍归 web）。web 侧改为再导出，Look 契约
  不变。
- velar/async 的 `sleep`/`timeout`/`retry` 延时、web 定时器 `after`/`every`
  参数改收 `Duration`。**一个拼写**：裸 number 退役并指引 `write 200ms`。
- 算术既有（`1s + 200ms` 折叠）；执行级回归覆盖折叠值进 sleep。

## 第 53 条 —— `test "名字":` 块（归批次 M）

### 证据

`def test_chart_scale_constructor_rejects_invalid_values()` 蛇形长名给机器看；
测试是 owner 要读的产品规格（使命：人来读）。

### 目标语义

```
test "chart scale rejects an oversized maximum":
    expect(construct_oversized).toThrow()
```

- 块语句，仅 `.test.vel` 文件语境（上下文关键字，别处 `test` 仍是普通标识符）。
- 体内可直接 `await`（async-capable，同 mounted）。
- 名字为字符串字面量，模块内唯一，报告器逐字引用。
- **一个拼写**：`def test_*` 发现机制退役并指引迁移；全仓 *.test.vel 迁移。

## 第 54 条 —— 格式化器 JSX 换行政策（归批次 L）

第一轮发现的 403 字符单行 JSX 至今合法 —— canonical formatter 的「唯一形态」
承诺未覆盖 JSX。实施者提出具体政策（行宽阈值、属性逐行阈值、子节点缩进），
与既有 format 惯例对齐；同波重排全部示例；幂等回归。

## 第 55 条 —— stdlib 错误码约定（归批次 K）

Lite 的 `safeToolError` 靠消息前缀匹配分类错误（被逼出来的丑）。约定：官方
Error 家族携带稳定 `readonly code: string`（`HttpTransportError` 已有先例方向）；
消息归人、code 归程序；velar/* 各家族编码规则成文（web-api / 标准库文档）。
纯 stdlib 约定，零语法。

## 第 56 条 —— 明确不加清单（一句理由，记档防复议）

管道 `|>`（双亲皆无）；Python 切片 `[a:b]`（冒号与类型位冲突、`.slice` 已够）；
Set 字面量 `{1,2}`（与记录字面量冲突）；Context/Provide-Inject（**模块 state
即 Vel 的答案**，典章补惯用法一条）；decimal 金额类型（D34 扩展车道）；
装饰器/属性标注（迁移诊断已是废弃机制）；for 过滤子句（链已覆盖）。

## 批次编排更新

新批次 **M（新语法波：第 50/51/53 条）**排在 G（保留字软化）之后 —— 两者都
深改 parser，串行。第 52/55 条并入 K；第 54 条并入 L。全局序：
J ✓ → A（在途）→ K → E/F → L → I+B → G → **M** → C/D。
每批次三道门禁 + skill 镜子规则不变；M 落地后 AI 简报加 using/try/test 三行。
