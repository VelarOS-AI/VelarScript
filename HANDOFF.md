# 交接书 —— Claude → Codex（2026-08-09）

用户指令：后续全部任务由 Codex 负责。本文是完整交接：现状、决策日志、待办队列、
工作纪律。设计规格在 `docs/handoff/`。撞墙账本在
`/Users/mac/Documents/VelarOS-Lite/LEDGER.md`（26 面墙全档案 + S4 性能结案）。

## 一、现状快照

**VelarScript**（本仓，`main`）：两天 21 个提交（`c56660a`…`d1187a4` + memo/batch
提交），编译器测试 310 → 370+，`npm test` 现在整编四个示例应用（`35ead9e` 加固，
教训见下），`npm run test:browser` 是唯一整编浏览器门禁。最后在途工作见第四节。

**VelarOS-Lite**（`/Users/mac/Documents/VelarOS-Lite`，本地 git）：蓝图五片全通
（聊天 UI / markdown extern 桥 / 流式 / 持久化 / 全 Vel Core 服务器 + bin 引导），
7 个提交。它是语言的**外部裁判**：每片开发的撞墙都记 LEDGER.md（L=语言缺陷 /
D=可发现性 / N=正常成本），修语言不修应用是默认方向。

**未推送**（权限拦截，用户手动执行或授权）：
1. `cd /Users/mac/Documents/VelarScript && git push origin main`
2. `cd /Users/mac/Documents/VelarOS-Lite && gh repo create VelarOS-AI/VelarOS-Lite --public --source . --push`

## 二、决策日志（全部已获用户确认，勿重开）

- **D1/D2**（`c56660a`）：origin 追踪与调用失效机制拔除；收窄=赋值+分支汇合，
  TS 式取舍。注解即契约（返回类型无回写推断）。
- **D5**（`b62c1c2`）：extern 字段=可信收窄位置；extern 类 match 穷尽性保守（跨
  realm instanceof）。
- **D8**（`79cc19a`）：泛型 v1 —— 仅 def、调用点两阶段推断、de Bruijn 身份、运行时
  围栏 VEL4022。无显式实例化语法。
- **D10**（`cecd8cd`）：首点续行（`.`/`?.` 开头的行延续上一逻辑行）。
- **D11**：Look 多 token 字符串在有构建器的属性上定向拒绝。
- **D13**（`dc28242`）：具名再导出 `export {x as y} from`；无 `export *`。
- **盲测协议**：三期闭环，唯一 L 类（多行链）已修；诊断指引的「一个当前拼写」
  语气是成文标准；guidance 恢复机制让各阶段同轮共报（`f31367c`）。
- **W-13**（`06a3702`）：模块级 action 合法且可导出。
- **W-15**（`c086565`）：组件函数体每实例只跑一次；prop 变更走 per-prop 响应单元，
  永不销毁重建（位置卸载才重建）。顶层 `const` 不追 prop 是成文刀锋（用 computed）。
- **D14/D14'/D14''**：memo/batch 之争的终局 —— 见 D26（属性级追踪覆盖后公开 API
  退场；无记忆化关键字，规格封存）。
- **D17/D19-D24**：语言人体工学批次（打点方法化、双槽 for、range、集合构造、
  字符串 in、**反引号多行**）—— 规格在 docs/handoff/，**尚未实施**。
- **D18**：velar/serve 第一方平台面 —— 规格在 docs/handoff/，尚未实施。
- **D25'→D26**：深层响应式为唯一默认 —— 完整设计 docs/handoff/D26-DEEP-REACTIVITY.md，
  **尚未实施，是当前最高优先级**。
- 有意不做（各有存档理由，勿翻案除非新证据）：match 表达式化、真值条件、List `+`、
  异步迭代（ChunkStream 模式够用）、`for await`、`.toString()`、for-else、标签 break。

## 三、用户的工作纪律（最高约束）

1. **最高设计法则**：「框架可以复杂，怎么复杂都无所谓做对就行；对外暴露的一定要
   简单，不能增加用户心智负担 —— 框架写一次，用是无数次」+「别埋坑」。
2. **一个明显拼写**：不加兼容别名；被移除的常见拼写给定向指引（"Use 'X'; …"）。
3. **优化三层纪律**：自动层全力做 → 成文契约 → 可选函数**只在**真实证据显示自动层
   覆盖不了时保留（「能完全覆盖就不要了」）。
4. **证据纪律**：语言改动尽量由盲测/Lite 撞墙账本驱动；改完重跑相应测量。
5. **决策协议**：Codex 决策，**动手前通知用户一声**；用户重申即为决定。
6. 马拉松风格：持续推进、干净重构不打补丁、决策留痕、最后汇总。

## 四、在途与队列（按序执行，防文件冲突）

1. **在途**：D14' agent（memo/batch 终态 + computed 自动记忆化）可能仍在收尾 ——
   查 `git log`/工作树确认其提交是否落地；其自动 memo 部分将被 D26 吸收改造（已知
   弃件，可接受）。用户还有芯片会话（TDZ 自引用初始化、component 泛型头诊断）在
   独立运行，工作树可能有其未提交 WIP —— **动手前先看 `git status`**，沿用「隔离
   worktree 验证 + 主树精确 hunk 提交」协议。
2. **D26 深层响应式**（旗舰，设计已可执行）→ 验收=打败 S4 memo 基线。
3. **L1**：D17 打点方法化 + D22 聚合 + D23 字符串 in + get-default 指引。
4. **L2**：D19 双槽 for + D20 range + D21 集合构造 + D24 反引号多行。
5. **D18** velar/serve/fs/env/host + Lite 服务器重写（删光 extern 声明）。
6. Backlog：W-23/W-25（emitter/重载 extern 声明）、W-26 字节面、增量流式
   （W-12/W-17）、computed 纯度差一步的编辑器提示、enter 键语义（证据不足暂缓）。

## 五、血泪教训（免重蹈）

- **`velar test` 不整编入口模块** —— RouteContext 哑雷因此潜伏了两个时代
  （`a3ba1fd` 修复 + `35ead9e` 门禁加固）。改 web/路由类代码必须跑
  `npm run test:browser`。
- 语句头错拼关键词曾产生误导级联 —— 新增关键词类错误务必配 guidance + 恢复
  （诊断分阶段门控的教训，`f31367c`）。
- 共享运行时对象有冻结字段表 + 版本校验（runtime-foundation.ts）—— 动运行时数据
  结构必须升版本号。
- 三份类型遍历器（compiler/index/cli project）曾经三处漏改其一 —— 改 ValueType
  必查全部。
