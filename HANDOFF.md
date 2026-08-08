# 交接书 —— Claude → Codex（2026-08-09）

用户指令：后续全部任务由 Codex 负责。本文是完整交接：现状、决策日志、待办队列、
工作纪律。设计规格在 `docs/handoff/`。撞墙账本在
`/Users/mac/Documents/VelarOS-Lite/LEDGER.md`（26 面墙全档案 + S4 性能结案）。

## 一、现状快照

**VelarScript**（本仓，`main`）：两天 23 个提交（`c56660a`…`20b8245`），编译器
测试 310 → 382（主树另含芯片会话 WIP 测试），`npm test` 现在整编四个示例应用
（`35ead9e` 加固，教训见下），`npm run test:browser` 是唯一整编浏览器门禁。
D26 已终局落地（上游 `bfd0f65` + Lite `9b34b80`）：属性级深层响应是唯一自动
性能层；memo/batch **无公开 API**，旧自动 memo、purity 证明和跨模块纯度标记已
全部退役。调度合并与属性级订阅是 web-api.md 成文契约。

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
- **D17/D22/D23**：L1 人体工学批次（打点方法化、List 聚合/排序、字符串 `in`）
  **已实施**；字符串/数字固有操作仅保留方法面，旧 `velar/text`/`velar/math` 函数
  拼写已干净移除并提供定向指引。
- **D19-D21/D24 + D18 后 clean-break**：双槽 for、range、集合构造与布局字符串
  **已实施**；反引号方案在同一开发周期内被删除。行内引号以换行为恢复边界，只有
  引号后立即换行才进入缩进布局字符串；`f`/`r`/`rf` 负责插值与原样反斜杠。
- **D18**：第一方本地平台面 **已实施**。Standard API 0.5 提供
  `velar/serve`、`velar/fs`、`velar/env`、`velar/host`；Node 仅是内部引擎，Web
  目标在项目编译期定向拒绝，本地运行时统一拥有 HTTP/静态文件/边界/信号清理。
  Lite 服务器已删光平台 `extern`/`import js`，bin 引导不变。
- **D25'→D26**：深层响应式为唯一默认 —— 完整设计与验收记录见
  docs/handoff/D26-DEEP-REACTIVITY.md，**已实施并打败 Lite S4 memo 基线**。
- 有意不做（各有存档理由，勿翻案除非新证据）：match 表达式化、真值条件、List `+`、
  异步迭代（ChunkStream 模式够用）、`for await`、`.toString()`、for-else、标签 break。

## 三、用户的工作纪律（最高约束）

1. **最高设计法则**：「框架可以复杂，怎么复杂都无所谓做对就行；对外暴露的一定要
   简单，不能增加用户心智负担 —— 框架写一次，用是无数次」+「别埋坑」。
2. **一个明显拼写 > 少写几个字**：不加兼容别名；被移除的常见拼写给定向指引
   （"Use 'X'; …"）。**统一优先于简省** —— 用户 2026-08-09 明确重申并据此否决
   了「非导出函数可省略返回注解」的提案：省略式会让读者每次判断「是省略了还是
   真返回 null」，歧义成本高于节省。同源裁决：不加记忆化关键字、state 只有一种、
   不加 .toString()、函数签名永远显式。**勿再以「少写几个字」为由提同类方案。**
3. **优化三层纪律**：自动层全力做 → 成文契约 → 可选函数**只在**真实证据显示自动层
   覆盖不了时保留（「能完全覆盖就不要了」）。
4. **证据纪律**：语言改动尽量由盲测/Lite 撞墙账本驱动；改完重跑相应测量。
5. **决策协议**：Codex 决策，**动手前通知用户一声**；用户重申即为决定。
6. 马拉松风格：持续推进、干净重构不打补丁、决策留痕、最后汇总。

## 四、在途与队列（按序执行，防文件冲突）

1. **已落定**：D14' 终局（`20b8245`/`b34bc6d`，见第一节）。**D26 实施时注意**：
   新的 __velarAutoMemo + purity.ts 机制建立在身份缓存上 —— 深层突变下同样有陈旧
   危险，D26 必须将其对深层追踪源禁用或按目标版本号重键（D26 设计文档第 8 条不变
   量同时覆盖新旧两套 memo 机制）。用户的芯片会话（TDZ 自引用初始化、component
   泛型头诊断）可能仍在独立运行，工作树有其未提交 WIP（compiler/web 的
   analyzer+parser、tests/CHANGELOG/charter 各若干 hunk）—— **动手前先看
   `git status`**，沿用「隔离 worktree 验证 + 主树精确 hunk 提交」协议。
2. **已落定：D26 深层响应式**（旗舰）→ Lite S4 每 chunk 从 10 次构建/~7 次
   M 扫描降为 0/0；上游与 Lite 三引擎门禁全绿。
3. **已落定：L1**：D17 打点方法化 + D22 聚合 + D23 字符串 in + get-default
   指引；上游 check/test/package/三引擎门禁全绿，Lite 完成 clean-break 迁移并通过
   shared 22 + server 11 + app build/format + 三引擎 33 场景。
4. **已落定：L2**：D19 双槽 for + D20 range + D21 集合构造 + D24 反引号
   多行；上游 check/test 382/package/三引擎门禁全绿，Lite 通过 shared 22 +
   server 11 + app build/format + 三引擎 33 场景，无新墙。
5. **已落定：D18**：Standard API 0.5 四个本地平台模块 + Web 编译期门禁；上游
   check/385 tests/package/三引擎门禁全绿。Lite 主服务器 266→146 行，平台 extern
   5→0、`import js` 5→0；shared 22 + server 6 + HTTP smoke 16 + 三引擎 33 场景
   全绿，W-21..W-26 的平台内建暴露关闭（通用 extern/公开字节操作仍归 backlog）。
6. **已落定：D18 后 clean-break 语法整理**：删除反引号与 `f`
   反引号字符串；行内引号仍以换行为恢复边界，只有引号后立即换行才进入缩进
   布局字符串，缺失关闭引号时在 dedent 前恢复。`f` 负责插值、`r` 负责原样
   反斜杠、`rf` 是唯一组合前缀；不新增关键字或三引号。断言消息统一为失败分支
   `assert condition else message`，旧逗号分隔只给迁移诊断。上游 check/385 tests/
   package/开发与生产三引擎门禁全绿；Lite 通过 21 文件格式、shared 22 + server 6、
   app build、HTTP smoke 16 与三引擎 33 场景，Markdown 围栏无需任何反引号转义。
7. **已审计结案：剩余 backlog 不阻塞下一阶段**：
   - W-23/W-25 保持第三方 JS 桥的一签名契约；仅加 overload 不能表达按事件字面量
     改变 listener 类型，反而会把字面量类型/重载解析带进公开语言。第一方平台复杂度
     已由 D18 内化，第三方包用固定 adapter facade；桥接文档补齐 extern 默认参数仅
     表示可省略、声明体不执行。
   - W-26 继续按 Standard API 0.5 的有意省略处理：`Blob` 是受限、不可构造的 opaque
     handle，不公开字节检查/构造；等真实 hashing/multipart 消费者出现再设计统一
     Node/Web `Bytes`，不从 Buffer 泄漏偶然 API。
   - W-12 异步迭代维持既定不做决定；显式 Promise pull 与 D18 async producer 已覆盖
     两个真实流式链路。W-17 是 Markdown 增量 parser + DOM morph 的跨所有者产品阶段，
     当前 234 code-point/20 chunk 测量不可见，不扩语言语法。
   - “computed 纯度提示”随 D26 退役：仓库已无 purity/memo 优化路径可提示；属性级追踪
     自动生效。Enter 已由 Playwright 三引擎证明正常，手工失败是 CDP 注入伪故障。
8. **已落定：Velar Web 0.10 发布级收口**：不再扩 Core 语法、不启动 `velar/game`、不新增
   Web API；先把现有十个 Web 模块的 `.vel` 源码、模板、打包安装、开发/生产与三引擎
   契约闭合。首个缺口是 realtime 验收曾由宿主直接导入生成的 JavaScript 模块，现已改为
   Release Studio 组件真实调用 `socket`/`eventStream`，并由组件 cleanup 释放资源；打包
   浏览器门禁也让安装后的生成应用导入九个运行时 Web 模块，由其浏览器测试导入第十个
   `velar/web-test`，再完成 check/test/build/verify/浏览器执行。稳定版本、tag、push 与
   npm publish 仍是独立授权，不属于本阶段自动动作。最终门禁为 check/83 个文档示例、
   389 tests、package consumer、开发与 CSP 生产三引擎、四个示例项目三引擎、安装后浏览器
   工程、release rehearsal + manifest verify 全绿；当时的 dev 版本与 tag 阻塞由第六节
   1–3 步正式关闭，push 与 npm publish 仍维持独立授权。

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

## 六、下一阶段：0.10.0 稳定版发布与面世（2026-08-09 决策，按序执行）

语言工程阶段到此结束 —— **不再新增语法或 Web API**（第四节 7/8 已把 backlog 审计
结案）。下一阶段的唯一目标是让语言存在于世界上：能装、能试、能被找到。

**D27 —— 发 `0.10.0` 而非 `1.0.0`**：方法化、布局字符串、深层响应式三处大改都在
最近一个开发周期落地，尚无任何外部用户接触过这个表面。1.0 是 API 稳定承诺，现在
给不起；先发 0.10.0 让人能 `npx` 试玩，等外部使用证明表面稳得住再上 1.0。刚发 1.0
就破坏性变更，比晚发 1.0 伤害大得多。

### 步骤（严格按序，每步门禁绿再进下一步）

1. **已完成：收尾**：芯片成果（TDZ 自引用遮蔽 + component 泛型头诊断）提交为
   `53edca6`；剔除了一个会倒退 D26 深层响应式文案的并行残留，最终 574+/1-、7 文件。
   `npm run check` + 389 tests + `npm run test:browser` 全绿。
2. **已完成：第四期盲测（发版闸门）**：协议见 `docs/handoff/BLIND-TEST-LEDGER.md`（三期完整
   记录与评分法）。**只测第三期之后改动的表面**：字符串/数字方法链、双槽 `for`、
   `range`、集合构造、**布局字符串**（无先例语法，风险最高）、深层 state 直接突变。
   干净盲写者、无文档、≤3 轮、真实编译器裁判。产出：(a) 发版前的最后一道证据；
   (b) 官网首屏要用的那个数字（无文档 AI 首次编译错误数）。结果 16 → 2 → 2，
   **L=0**，规范参考程序 Core/Web 零诊断并实际执行；证据提交为 `2660954`。
3. **已完成：0.10.0 收敛**：四个包版本号去 `-dev`；CHANGELOG 写正式发布条目（把本轮
   D17/D18/D19-D26 汇总成用户视角的变更说明）；`npm run release:rehearse` +
   `release:verify` 全绿；本地 tag 为 `v0.10.0`。push 与 npm publish 未执行。
4. **面世三件套**（可并行）：
   - **官网**：卖点一句话 —— *有 JS/Python 背景？不用看文档就能读懂*，配第四期
     盲测数字当证据。用 `create-velar --template docs` 自举（吃自己的狗粮就是最好的
     demo）。内容至少：一页速览、安装、语言参考、Web 框架、JS 互操作。
   - **VelarOS-Lite 开源**：完整可跑的真实应用当门面，比任何 README 有说服力。
   - **上手路径**：README 顶部 `npx create-velar@latest my-app` 三行跑通。

### 需要用户亲自授权/执行（不属于自动动作）

```
cd /Users/mac/Documents/VelarScript && git push origin main && git push origin v0.10.0
cd /Users/mac/Documents/VelarOS-Lite && gh repo create VelarOS-AI/VelarOS-Lite --public --source . --push
npm publish（四个包，需登录态与组织权限）
```

### 本阶段的纪律

- **不要在发版路上顺手加特性** —— 任何新想法记入 backlog，1.0 之后再议。
- 官网文案里的每个宣称都要有证据（盲测数字、可读产物示例、Lite 真实应用），
  这是这门语言的差异化，也是它最容易被戳破的地方。
