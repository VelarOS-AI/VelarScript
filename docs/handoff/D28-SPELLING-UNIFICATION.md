# D28 — 拼写统一三则（已批准，待实施）

用户于 2026-08-12 批准三条清理（第 4/5/7 条），并**驳回**第 6 条（事件修饰符保留）。
本文是可执行设计 —— 实施者不需要重新决策。

判据是用户当日重申的三条标准，按此顺序适用：

1. **正常语言用法**（原话：「就是正常语言的用法，不是什么特例独行」）
2. **盲写者不看文档能打对** —— 官网首屏卖点，Python/JS 拼写一致性优先
3. **一个明显拼写 > 少写几个字**（纪律 #2，不可用简省作为理由翻案）

同日相关裁决（背景，非本文范围）：条件只判真值（`bool`/`bool?` 直接判，`false`/`null`
均走 else；非 bool 可选值禁裸判，教 `!= null`）；语句边界必须闭合。两者由
硬化批次实施。`is not` / `not in` 作为类型/成员测试的负形式**保留**；但空值判断
唯一拼写后定为 `!= null` / `== null`（「is 测类型、==/!= 测值、null 是值」，
见 D30 第 22 条），`is [not] null` 为移除拼写。

---

## 第 4 条 —— `match` 兜底只保留 `case _:`

### 现状（缺陷）

两个拼写并存且语义完全等价。已实测确认穷尽性也等价 —— 两者都满足非空返回契约：

```
enum Status:
    a
    b

def withElse(s: Status) -> string:      // 通过
    match s:
        case Status.a:
            return "A"
        else:
            return "B"

def withWildcard(s: Status) -> string:  // 同样通过
    match s:
        case Status.a:
            return "A"
        case _:
            return "B"
```

charter 自身即不一致：§9 的类型模式示例用 `else:`，记录模式示例用 `case _:`。

### 目标语义

`case _:` 是唯一兜底拼写。`match` 语句中的 `else:` 成为诊断输入，不再是可运行拼写。

**理由**：Python 的 `match` 只有 `case _:`，**没有 `else`** —— 盲写者的手会打出
`case _:`。且 `_` 在嵌套模式位（`[first, _]`、`{kind: "x", value: _}`）本来就必须存在，
保留它等于一个通配概念覆盖所有位置；保留 `else` 等于为顶层单独发明特例。

### 实施

- Parser：`match` 体内的 `else` 子句给定向诊断，沿用「一个当前拼写」语气，例如
  `Use 'case _:' for the fallback case; 'match' has no 'else' clause`。恢复策略按
  既有 guidance 惯例（当作兜底分支继续解析，避免级联）。
- 分配下一个空闲 VEL2xxx；先 grep 全仓已用码位，并检查是否有集中诊断注册表 /
  API 清单测试需要登记新码。
- `if`/`else if`/`else` 与 Look 条件块中的 `else` **不受影响**。
- charter §9：删掉 `else:` 那个示例分支，改用 `case _:`；「`_` is the only wildcard」
  一句附近补明兜底也只用它。
- 迁移：`examples/production-web/src/components/project-list.vel:4-9`（`isHealthy`）
  等全部 `match` 内 `else:` 站点。以门禁为准，勿依赖本清单穷尽。

---

## 第 5 条 —— 「渲染空」唯一拼写为 `null`

### 现状（根因是类型缺口，不是风格）

示例语料两种写法混用，甚至同一文件内不一致
（`examples/support-desk/src/pages/tickets.vel` 第 99 行 `<></>`、第 110 行 `null`）。

根因已定位：`WebNode` 是纯扩展类型，**不含 `null`**（`packages/web/src/types.ts:15`
`webNodeType`）。JSX 子节点位 `null` 合法（charter §14「`null` and booleans render no
text」），但 `def metrics() -> WebNode:` 无法 `return null`，作者只能用 `<></>` 顶上：

```
    def metrics() -> WebNode:
        const current = payload()
        return current ? <>{current.metrics.map(...)}</> : <></>   // 被类型逼出来的
```

### 目标语义

- 「什么都不渲染」的唯一拼写是 **`null`**。
- 可能返回空的辅助函数声明为 **`-> WebNode?`** —— 这是诚实类型（可能没有结果），
  且与全语言「optional 必须显式 `?`」的规则一致。
- **不要**把 `null` 并入 `WebNode`。那会让 `WebNode` 成为隐式可空类型，与上述
  显式 optional 规则直接冲突。
- 无子节点的 `<></>` 给定向诊断指向 `null`。带子节点的 fragment 保留其真正职责
  —— 并排多个兄弟节点，不受影响。

### 实施

- Web 分析器/解析器：空 fragment（无子节点，含仅空白）诊断，例如
  `Use 'null' to render nothing; an empty fragment has no children to group`。
  分配下一个空闲码位（Web 扩展的码段），登记入需要的清单测试。
- 确认 `-> WebNode?` 在以下位置全部可用后再迁移：JSX 子节点插值位、条件分支、
  keyed 列表位。若发现 `WebNode?` 在某位置不被接受，那是本条的真实阻塞，
  **停下报告**，不要改成把 null 并入 WebNode。
- charter §14：明写「`null` 渲染空、fragment 用于分组」的分工。
- 迁移：`examples/api-dashboard/src/main.vel`（`metrics`/`traffic` 等 `-> WebNode`
  辅助函数改签名为 `-> WebNode?` 并返回 `null`）、`flow-board/src/components/task-form.vel:67`、
  `production-web/src/components/newsletter.vel:52`、`support-desk/src/pages/tickets.vel:99`。
  以门禁为准。

---

## 第 7 条 —— 撤掉 `invert`，放开 `x = not x`

### 现状（缺陷：拒绝全民拼写）

```
error VEL3018: Use 'invert target' to reverse a writable bool;
self-negating assignment is not part of VelarScript
```

`active = not active` 是 JS / Python / 几乎所有语言的全民拼写，被主动拒绝；换来的
`invert` 是零先例的新关键字。这与同日被推翻的 `if false` 属同一类「特例独行」。

证据面：全示例仅 2 处用上 `invert`（`production-web/src/pages/state-lab.vel:10-14`），
而真正高频的翻转形态 `{...todo, done: not todo.done}`（`examples/todo/main.vel:98`）
它根本够不着；字符串态翻转（`store.vel:17-20`）同样用不上。

### 三条原有理由的逐条复核（勿据此翻案）

- **「表达变更意图」** —— `x = not x` 的意图对任何程序员自明。
- **「避免重复复杂目标表达式」** —— 仅对 `flags[compute(i)]` 成立，而
  `flags[i] = not flags[i]` 重复求值 `i` **正是 JS 与 Python 的行为**，属正常语言
  语义而非陷阱。
- **「响应式读写合一」** —— mutation 只发生在事件处理器与 action 内，而两者是
  非追踪执行边界（web-api.md 成文），读依赖注册的隐患在实践中不存在。

### 目标语义

- `x = not x`、`panel.visible = not panel.visible`、`flags[i] = not flags[i]` 均合法，
  语义为普通读-改-写，求值次数与 JS/Python 一致。
- `invert` 关键字与 VEL3018 一并移除；`invert` 恢复为普通标识符（不再是保留字）。
- 若 `invert` 已进入任何公开清单（语法高亮、LSP 关键字补全、formatter 关键字表、
  API 清单测试），一并清理。

### 实施

- 删除 VEL3018 及其发射点；删除 `invert` 语句的 AST 节点、parser 分支、analyzer
  处理、emitter 降级、formatter 支持。
- 确认 `state` 绑定与深层字段的 `x = not x` 正确发布更新（属性级追踪路径），
  并加执行级回归。
- charter §4：删掉 `invert` 段落；§19「Deliberately absent」若列有自赋值否定，
  同步删除该条。
- 迁移：`examples/production-web/src/pages/state-lab.vel` 两处改为 `x = not x`。
- **验证建议（非放行闸门）**：下一期盲测记录首轮 `x = not x` 的命中率，为本条撤销
  留可复现痕迹。

---

## 第 6 条 —— 驳回：事件修饰符保留，但必须补文档

用户裁决保留 `on:submit.prevent`、`.self`、`.stop`。

**遗留缺口（必须闭合）**：修饰符实际存在（`packages/web/src/compiler.ts:583`、
web-api.md:856），但 **charter 的 JSX 指令清单里没有它们** —— 现状是两种拼写只
文档化了一种，读者只能靠猜。

实施（纯文档）：

- charter §14 的「Important native directives」清单加入修饰符，并写明分工：
  **无条件阻止用修饰符；条件性阻止用 `event.preventDefault()`**（后者不可删除，
  因为 `if not valid: event.preventDefault()` 只能写在处理器体内）。
- 示例的不一致按上述分工归位：`examples/todo/main.vel:92-95` 的 `addTodoOnKey` 是
  按键判断后才阻止，属条件性，保留手写 `preventDefault()`；三处表单提交属无条件，
  保留修饰符。两者都正确，文档写清即可，**不做机械统一**。
- 未来若考虑 `.capture` / `.passive`：那两个**不是**语法糖（映射 `addEventListener`
  选项，处理器体内无法表达），是唯一合格的扩充方向；纯糖修饰符不再新增。

---

## 门禁

三条改动分两批，避免文件冲突：

- **批次 A（Core）**：第 4 条 + 第 7 条 —— parser / analyzer / emitter / formatter /
  charter §4 §9 §19 / 示例。
- **批次 B（Web）**：第 5 条 + 第 6 条文档 —— web 包 / charter §14 / 示例签名。

每批次跑：`npm run check` → `npm test` → `npm run test:browser`（两批都触及 Web
编译或示例整编，浏览器门禁不可省）。两批全清后按惯例复跑一次对抗搜捕的相关维度。

**前置条件**：硬化批次（语句边界 + bool 条件）正在改 `parser.ts` / `analyzer.ts`，
本文两批必须等其门禁全绿后开工，否则必然冲突。

## 新增回归（永久）

- `match` 内 `else:` 得到定向诊断；`case _:` 保持穷尽性参与非空返回分析。
- 空 `<></>` 得到定向诊断；带子节点 fragment 与 `-> WebNode?` 返回 `null` 均正常
  渲染（执行级）。
- `x = not x` 在普通 `let`、`state` 绑定、深层字段、List 索引四种目标上均正确发布
  更新（执行级）；`invert` 不再被识别为关键字。
