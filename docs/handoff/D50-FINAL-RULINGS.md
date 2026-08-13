# D50 — 剩余开放问题的终局裁决（2026-08-14）

用户于 2026-08-14 明确授权编排代理**自行裁决本会话剩余的全部开放设计问题**，
并覆盖此前「D39-55 与 D35 Json/Text 保持 pending」的限制。本文是这些裁决的
权威文本；与之冲突的既有 handoff 文本以本文为准。

---

## 第 89 条 —— 错误的可判别性：类是唯一分类，`code` 是它的字符串投影（D39-55 定案）

### 阻塞点回顾

D39-55 只批了原则（「官方 Error 家族带稳定 readonly `code: string`」），
缺六样东西：家族 roster、既有抛错到 code 的映射、code 字符集/前缀、同 code 的
参数化边界、原生 `TypeError`/`RangeError` 的处置、跨 Core/Web/Node 的版本规则。
Codex 因此正确拒绝实现（不擅自造事实标准）。

### 裁决：不引入平行分类法

**一个错误只有一套分类：它的类。** `code` **不是**第二套 taxonomy，而是类身份
的**字符串投影**，由编译器自动提供，等于该错误类的**声明名**：

```
catch error:
    if error is FileNotFoundError:        // 语言内的判别拼写（唯一）
        ...
    log(error.code)                        // "FileNotFoundError" —— 同一身份的字符串形
```

这一条同时回答了 Codex 列出的全部六个缺口：

| 缺口 | 答案 |
|---|---|
| 家族 roster | **错误类层级本身**（下条系统导出） |
| 抛错 → code 映射 | **恒等映射**，无需维护、不可能漂移 |
| 字符集/前缀 | 类名规则（已成文：PascalCase 标识符） |
| 同 code 的参数化 | 不适用 —— 细节住在**字段**里（`path`、`status`…），不进 code |
| 原生 TypeError/RangeError | 宿主错误在边界归一化；其 code 是包装它的 Vel 类名，无包装则 `"Error"` |
| 版本规则 | 类名即 API；改名是破坏性变更，与语言其余部分同规（Vel 永不承诺兼容） |

**为什么不做平行 code roster**：那会制造第二套判别机制 —— 规则 3 违例。
类已经可判别（`is` 收窄、ValidationError/NarrowingError/IndexError 已可命名），
再发明一套字符串常量表只会让 AI 在两种拼写间摇摆。`code` 的正当用途只有
**序列化与日志**（类身份跨不过 JSON 边界），恒等投影正好满足且零维护。

### 落地要求

1. **`code: string` 只读成员**加入 checked `Error` 契约（与 `message`、`cause`
   并列），值 = 该实例的声明类名，编译器在类降级时提供（第 74 条已让 Error
   子类设置 `.name`，`code` 与之同源，二者不得分叉 —— 实现须共用一处真相）。
2. **stdlib 错误类家族系统导出**（方法学同 D41 的约束词汇：**反查代码而非想象**）：
   遍历 `packages/cli/src/standard-modules.ts`、`packages/node/**`、
   `packages/web/**`、`packages/desktop/**` 的**每一处抛错点**，按「**调用方
   会写出不同恢复逻辑**」归组 —— 同一恢复对应一个类，不同恢复必须分类。
   预期形态（实施者按实际抛错点定案，多退少补）：
   `velar/fs` → `FileNotFoundError`、`PermissionError`、`NotADirectoryError`；
   `velar/http` → `RequestFailedError`（带 `status`）、`NetworkError`、`TimeoutError`；
   `velar/serve`、`velar/terminal`、`velar/process` 同法。
   **每个新类必须有一个真实抛错点** —— 不为对称而造类。
3. **可命名**：三个既有内建（Validation/Narrowing/Index）已可命名，新类同规
   （`catch` 内 `is` 判别、不可被用户继承）。
4. **不做的**：不引入 code 常量表、不引入 code 命名空间、不改原生 JS 错误的
   身份、不为「未来可能的错误」预留类。
5. 文档：charter §11 增补一节（错误判别 = 类；`code` 是其字符串形）；
   standard-library.md 每个模块列出它会抛的类；AI 简报一行。

---

## 第 90 条 —— 纯计算全部常驻：`Json` 补全、`Text` 建立、`deepEqual` 退役（D35 冲突定案）

### 冲突回顾

D35 写「velar/json 全量常驻」并要求「velar/text 最终方法化清空」；批次 K 的
任务书只列了四个 Json 成员、未动 text。两处文字冲突。

### 裁决

**统一原则（D35 的「能算的不用导，能碰外界的必须导」全面执行）：**
**每一个纯计算函数都进常驻命名空间；每一个碰外界的能力保持显式 import。**

1. **`Json` 补全为全量**：批次 K 已落的 `parse`/`stringify`/`stableStringify`/
   `clone` 之外，`tryParse`、`isSerializable` 一并常驻。`velar/json` 的具名
   导入全部退役（迁移诊断）。
2. **`Json.deepEqual` 退役，`equals` 是唯一拼写**（N-3 一致性扫发现的双拼写）。
   实施者须**先实测两者的语义差异**：若 `deepEqual` 有 `equals` 不具备的能力
   （如仅接受 JSON 值域、或不同的 NaN/-0 处置），**扩展 `equals` 吸收之**，
   不得保留两个函数；差异若纯属实现细节则直接删。理由：内容比较是一个概念。
3. **建立 `Text.` 常驻命名空间**，收纳 `velar/text` 的全部纯函数
   （slug、escapeHtml、utf8Size、lineStarts、chunks、dedent、truncate、title、
   capitalize、normalizeWhitespace、lines、模式操作族…），`velar/text` 的具名
   导入退役。
   **推翻 D35 的「Text. 不建、改用方法」**，理由具体：把 20 个函数方法化会让
   核心字符串成员表**翻倍**（现 18 个，全是高频操作），迫使每个 AI 背下
   `utf8Size`/`lineStarts` 这类多数程序永不触碰的成员；而 `Text.` 给它们一个
   零导入、可发现、与 `Json.`/`Promise.`/`Look.` 一致的家。核心字符串方法表
   **保持不变**（不新增、不迁出），规则一句话：**「字符串方法是核心操作，
   `Text.*` 是扩展工具箱」**。命名冲突不存在 —— 类型名是小写 `string`。
4. **TXT-U4 的 `codePoint`/`fromCodePoint`** 随本条落在 `Text.` 下
   （代理半拒收，见文本审计）。
5. **能力模块不变**：`velar/fs`、`http`、`storage`、`browser`、`serve`、
   `terminal`、`process`、`app`、`forms`、`web-test` 全部保持显式 import。
6. 文档：charter 的常驻命名空间小节列全四个（Json/Promise/Text/Look）与该
   一句话规则；standard-library.md 重排为「常驻纯计算」与「须导入的能力」两部分；
   AI 简报的常驻段落补 `Text.`。

---

## 第 91 条 —— 文件监视的武装语义成文（WATCH-1 定案）

`watchFiles` 之后立刻写入的变更**可能永不到达**（macOS FSEvents 异步武装，
流从武装那一刻起算 —— 已实测：高负载下 40 次丢 4，一次窗口达 25 秒）。

**裁决：成文，不加魔法**（实施者推荐的 (a)）。理由：自探测方案要付一次虚假
事件 + 对根目录的写权限，把平台事实换成产品债；而「监视器只观察武装之后的
变更」是所有文件监视 API 的**真实语义**，说清楚比假装消除更诚实。

落地：`docs/standard-library.md` 的 `watchFiles` 条目 + charter 能力面一句：
**「监视器只报告它武装完成之后发生的变更。若你需要观察自己即将写入的变更，
先写入再开始监视，或在写入前后各查询一次状态。」** 纯文档。

---

## 第 92 条 —— 死表面清理

1. **`Opacity` 从 `LOOK_PUBLIC_TYPE_NAMES` 移除**（N-3 发现）：它在公开类型名
   册与 runtime 里，但 `opacity` 属性的类型是 `number`，**没有任何源码语法能
   产出 `Opacity` 值** —— 发布一个不可达的名字比不发布更糟。
2. `packages/cli/stdlib/` 空目录（D48 迁出后残留）删除。
3. 实施者遇到的同类死表面一并清理并在报告列出。

---

## 第 93 条 —— 剩余计划批次的执行顺序（编排决定）

授权范围内，剩余批次按下列顺序推进，各自独立分支、编排方串行合并：

- **波 R2**：第 89 条（错误类家族）+ 第 90 条（Json/Text 常驻）+ 第 92 条（清理）
- **波 G**：软关键字（D30 第 16 条 + 语法审计的 160 探针碰撞网格；
  `mounted`/`cleanup` 随 D43 第 67 条迁到 `@` 前缀一并落地）
- **波 M**：`using`（D43 第 69 条 `@dispose`）+ `try` 表达式（D39 第 51 条）+
  `test "名字":` 块（D39 第 53 条）+ 封闭词汇类型约束（D41 第 61 条完整词汇）
- **波 L**：`velar fix`（D38 第 48 条）+ 格式化器 JSX 政策（D39 第 54 条）+
  打包体积分项（MIG-3）+ 未捕获错误呈现（MOD-U10）
- **波 C/D**：文档与示例清扫、盲测第二轮（引导故事修完后复测 Web 返工数）

每波：定向验证 + 三门禁；本地提交；不 push。


---

## 第 94 条 —— `case` 与 `enum` 是 JS 保留字，不可作绑定名（波 G 上报，裁决确认）

波 G 执行级证明（本编排代理独立复验：`node -e "eval('const case = 1')"` 与
`enum` 同样 `SyntaxError`）：**`case` 与 `enum` 都是 ECMAScript 保留字**，
作为 Vel 绑定名会发射出 Node 拒绝解析的 JS。

- **D30 第 16 条把 `case` 与 `match` 一并归入「JS 不保留、可软化」是分类错误**，
  并给出 `for case in cases:` 作目标 —— 该目标不可达。D30 自己为 `enum` 写的
  理由逐字适用于 `case`。
- **本编排代理给波 G 的任务书把 `enum` 列进「必须可作绑定名」同样是错的**，
  与 D30 的既有裁决冲突；波 G 按 D30 执行是对的。

**裁决（确认波 G 的处置）**：`case` 与 `enum` 在 Vel 内**照常软化**（记录字段、
成员名、match 分支、成员访问全部可用），但**不可作绑定名**，诊断说出真实原因
（「`case` 是 JavaScript 保留字，产物无法解析」）。

**明确排除的替代方案**：让发射器重命名源绑定。它与 charter §19 及「产物是可读
的逃生通道」这一产品承诺相抵 —— 用户读发射产物时看到的名字必须是他写的名字。
两条硬保留名的代价（两个词）远小于「产物名字会被悄悄改写」的代价。

同理适用于将来任何被发现是 JS 保留字的候选词：**软化的边界由母亲的保留字表
划定，不由我们的愿望划定**。
