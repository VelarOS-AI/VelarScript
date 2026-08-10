# 交接书 —— Claude → Codex（2026-08-09）

用户指令：后续全部任务由 Codex 负责。本文是完整交接：现状、决策日志、待办队列、
工作纪律。设计规格在 `docs/handoff/`。撞墙账本在
`/Users/mac/Documents/VelarOS-Lite/LEDGER.md`（30 面墙全档案 + S4 性能结案）。

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
- **D18**：第一方本地平台面 **已实施并扩展**。Standard API 0.5 的
  `@velarscript/node` 扩展提供 `velar/serve`、`velar/fs`、`velar/env`、
  `velar/host`、`velar/path`、`velar/process` 与 Node 目标的 `velar/http`；Node ABI
  不进入语言表面，Web 只定向拒绝 Node-only 模块，共享的 `velar/http` 由显式目标
  扩展接管。Lite 服务端已删光平台 `extern`/`import js`。
- **D25'→D26**：深层响应式为唯一默认 —— 完整设计与验收记录见
  docs/handoff/D26-DEEP-REACTIVITY.md，**已实施并打败 Lite S4 memo 基线**。
- 有意不做（各有存档理由，勿翻案除非新证据）：match 表达式化、真值条件、List `+`、
  generators/`yield`/JavaScript `Symbol.asyncIterator` 与 `for await`、`.toString()`、
  for-else、标签 break。真实 ChunkStream 证据已推翻“完全不做异步迭代”的旧结论，
  当前语言使用明确的 Velar `async for` 拉取协议（见第八节）。

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
   - W-12 的旧“不做异步迭代”结论已由后续 Lite 重复手写 pull loop 的证据推翻：Core
     现提供 `async for` 消费显式 `next() -> Promise<T?>`，但 generators、`yield` 与
     JavaScript `Symbol.asyncIterator` 仍有意不做。W-17 是 Markdown 增量 parser + DOM
     morph 的跨所有者产品阶段，当前测量不可见，不再扩语言语法。
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

### 第 4 步规格：面世三件套（2026-08-09 定，Claude 独立复核 0.10.0 后下达）

**复核记录**：四包版本一致、注释标签 `v0.10.0` 对准 HEAD、树干净、
`release:verify` 绿、`npm test` 389/389 + 四个示例整编全绿 —— 放行发布。

**官网**（最高优先，没有网站的语言不存在）

- 自举：`create-velar --template docs` 用 Vel 写官网本身，站点即最大的 demo。
  域名沿用 `velarscript.velaros.cn`，部署体系与 VelarOS 官网保持一致。
- **首屏叙事用「诊断即教学」，不要用裸数字**。四期盲测的诚实故事是：
  *一位从未见过这门语言、不看任何文档的 AI，靠编译器诊断本身，三轮内写出
  两个可运行程序；四期累计语言缺陷 0 条。* 首轮 16 条诊断是过程数据，
  **严禁写成「首次编译通过」**（账本已明令）。真正的差异化是错误信息会教你
  唯一正确的拼写 —— 这条别人抄语法容易、抄不走。
- 必备页面：一页速览、安装与 `npx` 上手、语言参考、Web 框架、JS 互操作
  （含「产物是可读 JS、随时可以不用 Vel 继续写 JS」这条反锁定承诺 —— 采纳者
  最关心的就是退出成本）、为什么不是 TS（AI 生成的类型维护负担这个真痛点）。
- **上手内容必须覆盖第四期的 D 项**：标准模块从哪导入（`range` 的教训）、
  `f"..."` 插值而不是 `${...}`、布局字符串的开闭规则。

**VelarOS-Lite 开源**：完整可跑的真实应用当门面。README 讲清它是语言的外部
裁判，LEDGER.md 的 26 面墙全档案就是研发诚实度的证明 —— 这是加分项不是黑历史。

**上手路径**：README 顶部三行跑通 `npx create-velar@latest my-app`。

### 0.10.1 backlog（不阻塞发版，按价值排序）

1. **知名标准库名字的 unknown-name 指引**（第四期唯一未自愈摩擦）：裸 `range`、
   `sleep` 等标准模块导出，unknown-name 时直接给出所在模块与 import 写法。
   套路与既有 25 条指引一致，成本极低，把最后一条摩擦清零。
2. 其余 D 项与真实用户反馈一并进队。

### 本阶段的纪律

- **不要在发版路上顺手加特性** —— 任何新想法记入 backlog，1.0 之后再议。
- 官网文案里的每个宣称都要有证据（盲测数字、可读产物示例、Lite 真实应用），
  这是这门语言的差异化，也是它最容易被戳破的地方。

## 七A、0.10.0 发布已中止：硬化阶段（2026-08-09，用户叫停，证据支持）

用户在发布前叫停：「现在语法什么的还不确定有没有 bug 之类的」。据此做了一轮
**六路对抗性缺陷搜捕**（380+ 探针程序，真编译真运行，每条发现再对抗性复核，
默认立场是驳回）。结果：48 条原始发现，**41 条确认为真** —— blocker 4、
major 29、minor 8。完整清单含复现：`docs/handoff/HARDENING-DEFECTS.md`。

**本地 tag `v0.10.0` 已删除**，第六节的 `git push origin v0.10.0` 与 npm publish
**在硬化完成前不得执行**。仓库从未推送，所以没有已发布的破损版本需要撤回。

四个 blocker（其余见清单）：
1. **循环回边不作废收窄事实** —— 循环体内的赋值对下一轮迭代不可见。编译干净、
   运行错误；`-> string` 的函数能返回 null，验证过的 `unknown` 能脱验。这是流分析
   的健全性洞，与当年 origin 机制方向相反（过松而非过严）。
2. 空集合迭代不注册依赖 —— 加入的第一个元素永不渲染。
3. 双槽 `for key, value in map` 不追踪 iterate key —— 新条目与 `clear()` 界面不动，
   且漏出未包装的裸 key。
4. 解构 / `match` 记录与 List 模式 / 记录展开**丢失深层响应** —— 三种最常用读法
   全部不更新。

教训（写进第五节的同级）：**特性作者写的测试证明「设计如预期工作」，不证明
「没有缺陷」**。389 个绿测试与四期盲测都没能发现上述任何一条 —— 盲写者写的是
惯用代码，不会去踩边界。发版前必须有一轮独立的对抗性搜捕。

### 修复编排（按包分波，避免文件冲突）

- **第一波**：① compiler 流分析健全性（blocker 1 + try/finally 误拒 + 模式中的
  关键字字段名）② web 深层响应式（blocker 2/3/4 + json 序列化丢依赖 + List.pop
  未包装 + keyed 无界滞留 + 渲染循环无护栏 + prop 只读别名绕过）③ cli 平台与
  互操作（velar/serve IPv6、`import js unsafe` 相对 .js 路径、导入 state 赋值诊断）
- **第二波**：④ compiler 字符串与限值（f-string CR、空白行裁剪、孤立反斜杠、
  未知转义静默吞、深嵌套与超长表达式爆栈）+ 值方法语义（`$` 替换泄漏、Infinity、
  padStart/padEnd 码点、`sorted(by=)` 类型接受面、Set 取自宿主数组的 undefined）
  ⑤ web 解析器（JSX `{}` 与 `look:` 内的布局字符串、JSX 属性反斜杠被删）
- 每波结束跑全量门禁；两波全清后**重跑一次搜捕**（同一 workflow 脚本），零 blocker
  且无新 major 才恢复第七节的发布流程。

### 历史交接状态：第一波被中途叫停，工作树里有未验证的半成品

用户因额度耗尽叫停（2026-08-09），三个修复 agent 在跑到一半时被终止。**工作树里
留下 8 个文件、约 +412/−50 的未提交改动，全部未过门禁、不可信**：

| 文件 | 来自哪一路 | 被打断时的自述进度 |
|---|---|---|
| `packages/compiler/src/{analyzer,parser}.ts` | ① 流分析健全性 | 「五条缺陷都已表现正确」，但全量测试没跑完 |
| `packages/web/src/{emitter,runtime-foundation}.ts` | ② 深层响应式 | 正在做让解构/展开/match 模式可追踪的 descriptor 陷阱 |
| `packages/{node/src/compiler,cli/src/preview-server,cli/src/project}.ts` | ③ 平台互操作 | Node 所有权迁移后继续保留真实 IPv6 与断连回归 |
| `tests/compiler.test.ts` | 三路共同 | 新增回归测试，来源交织 |

**接手时先决定这堆怎么处理。** 建议 `git checkout -- .` 从干净状态按上面的编排
重做 —— 未验证的半成品比重做更贵，尤其是三路的 `tests/compiler.test.ts` 改动交织
在一起，无法按路拆分。若选择接着改，必须先逐文件读懂再跑全量门禁，不要假设它是对的。

缺陷清单（`docs/handoff/HARDENING-DEFECTS.md`，41 条含最小复现）与本节的分波编排
都已提交，不受这堆半成品影响。

### 硬化完成状态

- 接手时按建议丢弃了 8 个未验证文件的半成品，从干净基线重新按两波实现。
- 41 条确认缺陷已全部关闭，永久回归分布在五个 `tests/hardening-*.test.ts` 文件；
  详细映射与复搜捕结果见 `docs/handoff/HARDENING-DEFECTS.md` 顶部。
- 两波合并后重跑六路对抗性搜捕，结果为 **blocker 0 / new major 0**；复搜捕发现的
  #9、#15/#20、#28 变形也已关闭并再次独立复核。
- 最终门禁全绿：格式、文档、TypeScript 与四包构建；425/425 测试；包消费者验收；
  Chromium/Firefox/WebKit 开发与生产矩阵；四个示例共 48 个跨浏览器测试；安装包浏览器验收。
- `v0.10.0` 仍不存在。41 条硬化修复已按用户指令本地提交为 `c105c18`，未推送、
  未发布；任何 tag、push、npm publish 或恢复第七节发布流程仍须等待用户明确下令。

### 当前继续开发状态（2026-08-09，未提交）

用户要求暂不恢复 0.10.0 发布，继续让 Lite 充当外部裁判，并让 Workbench 与
Core/Node 使用面同步推进。当前一组小边界已闭环：

- `velar/web-test` 增加仅浏览器测试运行器可用的原始 `localStorage` / `sessionStorage`
  控制器；Lite 删除生产 `?corrupt-storage=1` 后门，改由测试写入真实损坏快照，恢复后
  同时重写持久层为规范数据。
- Lite 采用导出的模块级 `action sendMessage` 及其 `.pending`，删除组件内重复 action；
  硬化后的 JSX 换行与 keyed 跟踪已让旧 workaround 退役。
- `ServeRequest.text/json(maxBytes=...)` 在累计前执行字节预算，并通过不可构造的
  `RequestBodyTooLargeError.maxBytes` 提供稳定 413 映射；Lite 的 64 KiB 策略已有
  65,537-byte 真实 HTTP 回归，记为 W-27。服务端流写入同时补齐断开语义：背压中的
  `write` 在客户端关闭时拒绝并清理监听器，生产者可在 `finally` 释放上游请求。
- Workbench 的 Vel 贡献已对齐当前字符串与命令表面；通用 LSP 启动器按 Node 项目
  语义从嵌套项目向上寻找最近的 `node_modules/.bin`。四个 rehearsal tarball 的真实
  安装态同时验证 Web 项目和无框架 Core/Node 项目的诊断、补全、签名与 hover。

门禁：VelarScript 426/426、包消费者与完整三浏览器门禁全绿；Lite check、17-case
HTTP smoke 与此前未受服务端改动影响的 33-case 三浏览器门禁全绿；Workbench 完整
check（边界、类型、lint、50 tests、probes、production build）及安装态工具链验收全绿。
三仓本组改动均未提交、未推送、未发布。

随后按用户“零第三方 JS、产品逻辑全 Vel”要求完成一项不改变重大架构边界的
clean break：Lite 删除 `markdown-it`、`highlight.js` 及其完整传递依赖，改用纯 Vel
安全 Markdown 子集；Core 测试增至 26，Lite check/build、17-case HTTP smoke 与
33-case 三浏览器门禁全绿。`npm run test:browser` 现在默认跑 Chromium/Firefox/WebKit，
不再把全矩阵依赖于人工追加参数。该迁移发现并关闭 W-28：格式器给布局字符串空白行
重新写入内容缩进，导致格式化结果自身无法通过 `git diff --check`；修复后覆盖空白行、
幂等与运行字节语义。相关改动仍未提交、未推送、未发布。

此前真实 `npm pack` → 空目录安装曾确认 W-29 开放：当时 tarball 不含 `app/dist`，消费端
不会安装开发期 `file:../VelarScript` 工具链，而手写 bin 硬编码兄弟仓 CLI 路径，离开源码
布局即退出。因此“一份 npm 包就是应用”仍是目标而非现状；README 已收回错误宣称。
正确关闭条件是 Node 应用宿主生成自包含入口与预构建浏览器资产，并在空目录安装后跑通
健康检查、Agent 工具循环与无孤儿退出。该所有权属于待确认的 `@velarscript/node` 重大
边界，不在 Lite 启动脚本内继续打补丁。该记录保留为发现证据；后续确认后的关闭状态
见本节末尾。

Lite 曾完成显式结果契约清理，全部普通 `def`、模块 action、组件内回调与测试均写出真实
结果或 `-> null`。用户随后否决 W-30 的强制显式边界，当前语言权威改为真正的函数体结果
推断：普通函数、具体方法与 action 可省略结果，Analyzer 合并可达 return，并把可达自然
结束计入 `null`；async 推断 resolved value，模块接口携带最终推断结果。函数和模块递归通过
有界定点迭代收敛，无法求解的纯递归结果用 `VEL4025` 要求显式契约。只有无函数体可分析的
extern 与 abstract 方法继续用 `VEL4023` 要求显式结果；getter、constructor、component 与
上下文类型化箭头保留各自既有契约。原有显式 `-> null` 仍完全合法，不做机械删除。

用户已确认 Node 边界；W-30 曾确认后又按上段最新决定改为自动推断。第一波已把
Node-only 实现从 CLI 组合层抽成独立 `@velarscript/node`，由其拥有 `velar/serve`、`velar/fs`、`velar/env`、
`velar/host` 的类型契约与运行时；CLI 仅通过扩展 ABI 组合，五包发布与空目录安装验收
同步对齐。下一波由 Lite 真实 Agent 需求驱动补齐服务端流式
`velar/http`、process/path 与应用宿主，并验证背压、取消、超时、上游错误与密钥边界。

该下一波现已完成到“可运行只读 Agent”边界：`@velarscript/node` 新增有界 fs
读写/元数据/规范路径、纯路径运算、无 shell 子进程与 Node HTTP 流客户端；HTTP
取消和超时覆盖整个响应体消费。Web `velar/http` 同步获得 `streamText` 并修正相同
生命周期；`velar/web-test.network` 让浏览器测试可在隔离源内模拟后端，生产应用不再
保留假 provider 分支。实现 OpenAI 事件记录时又关闭一处语言别扭：`arguments` 只在
JavaScript 绑定位置受限，记录字段、字面量和成员访问均合法，绑定误用仍由 `VEL3007`
定向解释。

Lite 已用纯 VelarScript 建成 provider-neutral Agent Core、OpenAI Responses SSE
适配与基于显式项目根的 `read/list/search` 三个只读工具；provider 别名只存在于
传输边界。该阶段的旧 Workspace 命名后来已按本节第八节 clean-break 删除。路径同时执行词法与 realpath
封闭，符号链接越界 fail closed；生产无密钥时返回 503，罐头 provider 仅在明确
`VELAROS_DEMO=1` 的测试启动中存在。写入、进程和打开工具尚未暴露，必须等审批状态机
完整后再接入。

将 Lite 的最后一条 Node 集成 smoke 改写成 VelarScript 后又发现并关闭进程生命周期
缺陷：旧 `Process.stop()` 只杀 CLI 根进程，`velar run` 生成的实际服务成为孤儿并继续
占用继承管道，使 `wait()` 永久挂起。Node runtime 现默认以进程树为所有权单位；stop、
timeout、输出越界与根进程提前退出都会收掉后代。真实后代 PID 回归与 Lite 17 项
纯 VelarScript HTTP/流/静态文件/遍历/关停 smoke 均通过，运行后无残留进程。

本波证据：VelarScript 428 项中 427 项初跑通过，唯一失败是新增 `network` 后严格 API
清单漏列该导出；更新清单后定向契约测试通过，完整三浏览器、四示例与安装包浏览器
验收全绿。五包 release rehearsal 通过；Workbench 完整 check（50 tests、probes、
production build）与五包安装消费验收通过。Lite check、29 shared + 10 server tests、
production build、17-case HTTP smoke 与 36-case Chromium/Firefox/WebKit 门禁全绿。
文档收口后的最终全量重跑为 428/428，package consumer 与 release rehearsal 再次通过。

W-29 随后关闭：Core `velar build` 已能生成完整服务端模块图与按需 Node 标准模块，Lite
发布清单现在只打包预构建 `app/dist`、`server/dist`、许可/README 与极薄加载入口；
`@velaros-lite/shared` 只留在开发依赖，tarball 运行依赖为 0，入口不再搜索兄弟仓或调用
`velar` CLI。永久 package acceptance 会真实 pack、禁脚本空目录安装、核对资产与依赖、
启动安装后的 bin、探测 health 与 Agent 流、SIGTERM 后验证 exit 0/关停日志并清理沙箱，
现已全绿。三仓均未提交、未推送、未发布。

在不扩大权限的后续产品波次中，Lite 又把工具状态从 assistant Markdown 正文剥离为
持久化的 typed activity（running/completed/failed/cancelled），按 call ID 与规范 tool ID
严格配对，异常/取消会收敛所有 pending 卡片。独立工具卡与消息正文、模型上下文完全
分离；对话只在消息开始、工具出现、流结束三个稳定边界跟随到底部，不按每个 chunk
抢夺滚动位置。真实页面检查发现 demo provider 原先没有调用工具，使 package “tool-loop”
证据名不副实；现已改为真实 `lite:list → output → continuation`，纯 Vel smoke 与
空目录 package acceptance 都强制观察 started/finished/text/completed，三浏览器 36-case
门禁与本地渲染检查通过。审批、写入、执行、打开与审计日志仍停在用户确认边界之外。

继续用 Lite 对真实 provider 边界做对抗测试时，又关闭了一组未扩大权限的协议与语言
问题。OpenAI Responses 适配器现在区分 `completed`、`failed`、`incomplete` 与顶层
`error` 终态；拒绝文本作为 assistant 内容流出，多工具调用按源顺序保留，重复 call ID、
拒绝完成不一致、终态或 `[DONE]` 后继续输出、缺失完成与截断 SSE 均 fail closed。真实
本地 SSE 服务器覆盖八种成功/异常场景，Lite 门禁更新为 29 shared + 16 server、17 smoke、
36 browser 及空目录 package acceptance 全绿。

这些测试还暴露出 Analyzer 把回调的局部形参名错误纳入函数类型可赋值性：`_request`
无法满足 `(request: Request) -> Result`。现已按结构类型原则修正；可赋值性只比较参数
域、arity/rest/default、泛型与结果，不比较局部名字。具名调用仍由声明或目标注解提供
公开标签并按声明顺序 lowering。新增执行回归证明 `_request` 实现可通过
`request="ok"` 调用。本组仍未提交、未推送、未发布。

下一波 Lite 硬化又在独立的 class override 路径发现了同类 W-36 缺陷。普通与 extern
override 现在都会在保持 arity、optional/rest、参数类型、泛型身份与结果类型的前提下，
忽略实现局部的参数标签；base/extern 声明仍拥有通过其类型进行具名调用时的公开标签，
具体声明拥有自己的局部标签。VelarScript 完整门禁现为 430/430，四个示例应用也全部
检查、测试通过。

Lite 同时在不扩大写权限的前提下关闭两组产品边界。共享 Agent NDJSON decoder 现在要求
恰好一个显式终态，并拒绝事件元数据错误、无终态的 clean EOF、不完整记录与终态后事件；
UI 保留用户取消意图、收敛所有 pending 工具卡，并在已有部分文本时仍显示传输失败。
Agent Core 限制工具步数和每步调用数、拒绝跨 turn 重用 call ID，并要求最后一次 provider
continuation 产出正文。启动配置对损坏或半配置状态 fail fast，真实 smoke 证明它会在监听
端口前退出。

用户确认较大的读取安全设计后，Lite 已把本地工作区授权与远端 provider 披露拆成两个
owner。发给 provider 的工具结果是 typed untrusted envelope，并在 dispatch 前经过纯 Vel、
确定性的 secret redaction；活动配置和常见凭据路径从 read/list/search 三面统一隐藏。
System scope 不再默认整个 HOME，而是默认 `~/.velaros-lite/workspace`，只有显式 config/env
才授予更大的根。远端 provider endpoint 必须使用 HTTPS，HTTP 只对 loopback 本地服务
开放；空白消息也在服务端入口统一拒绝。当前 Lite 证据为 check、32 shared + 25 server tests、20-case 纯 Vel
real-server smoke、45-case 三浏览器矩阵、production build 与独立包验收；Workbench 的
50-test/probe/build 完整 check 和五包安装态工具链验收也保持全绿。本波仍未提交、未推送、
未发布。

## 七、下一个大阶段：从「造出来」到「有人用」（发布恢复后执行）

**为什么是这个**：语言已冻结并验证完毕，再做任何工程都是无外部证据的猜测。
这个项目至今零外部用户 —— 四期盲测是 AI 代理，Lite 是自建裁判，所有证据都产自
同一个闭环。唯一未被检验的命题是：圈外的人要不要这个东西。**本阶段的产出不是
代码，是外部证据。**

### 交付物（按序）

1. **发布**：第六节的四条命令（用户执行）。没发布，后面全是空谈。
2. **官网**：规格见第六节第 4 步。
3. **Lite 补真 LLM 转发，然后开源**。理由：作为门面，罐头回复的聊天客户端会
   当场折损可信度。服务端流式管道已通（S3/S5），把 canned stream 换成真实
   provider 调用即可；密钥仍只驻留服务端（`velaros-lite.config.json` 占位已在）。
   顺带验证一个新语言表面：真实 HTTP 客户端 + 外部流消费 + 密钥边界 —— 照旧记
   LEDGER。**这是本阶段唯一允许的功能开发**。
4. **首批用户与反馈回路**：
   - 投放：`r/programminglanguages`、Show HN、中文技术社区。开场白就是官网首屏那
     句 —— 不是「更好的 JS」（赛道已满且都是尸体），是**「诊断即教学：AI 不看文档
     也能写对」**，配四期盲测的可复现档案。
   - 回路：issue 模板照搬盲测账本的结构 —— 你想写什么 / 编译器说了什么 / 你怎么
     解决的。真实用户的摩擦按 L/D/N 分类，进一个公开版账本。这是把内部机制搬到
     外部，裁判从 AI 换成真人。

### 判据（本阶段何时算完）

- 有 ≥1 位圈外的人独立跑通 quickstart 并写出能跑的东西（不是 star，是使用）
- 收到足以分类的真实摩擦，**1.0 的变更清单由这些反馈决定，而不是我们的想象**

### 本阶段明确不做（等反馈再议）

- `velar/game`（canvas 包）—— 用户最初的愿景之一，但在 web 侧还没有外部用户之前
  开第二条战线会稀释一切。有人真的要求再说。
- 1.0 —— 由反馈驱动，不是由时间驱动。
- 大范围 VelarOS Workbench 产品整合、移动端、多模型编排。用户后续要求的 Vel
  语言支持与安装态 Core/Node 工具链验收属于当前编译器工具链闭环，不扩大为产品整合。

## 八、当前执行队列：0.10 继续开发，Desktop/Lite 作为语言裁判

> 本节覆盖第七节“立即发布”的旧队列。用户已明确中止 0.10.0 发布，并授权代理按
> VelarScript 的长期定位直接决定甚至破坏性修改重大语义，不再因等待语言设计确认而
> 停止。核心产物始终是 VelarScript 与官方生态；Lite 可以被破坏或重写，只用于证明
> 纯原生 Vel 是否真正可用。未经再次明确授权，不提交、不推送、不打标签、不发布。

当前已落地的纵向切片：

- npm 仍是安装、版本、完整性与唯一 lockfile 权威；VelarScript 新增 versioned
  extension contract 与 parent-first semantic graph，拒绝 parent/API 不匹配、循环、模块
  所有权冲突和多个 application extension。
- 第六个官方包 `@velarscript/desktop` 让用户只写一个普通 Vel 项目，复用 Web 的
  component/JSX/Look/state/action；renderer/main/端口/IPC 仅是内部安全边界。macOS 包使用
  WKWebView + 隔离 Node capability worker，不含 Chromium/Electron/Tauri。
- 边界纠偏：Agent 编排、工具注册与执行策略不属于语言标准库或官方语言工具链，已经撤销
  错误加入的 `@velarscript/agent`。这些能力归 VelarOS Platform/产品生态所有；VelarScript
  只提供实现它们所需的语言、Node/Web/Desktop 目标与能力边界。工具的内部唯一身份遵循
  VelarOS 的 `namespace:tool` 契约，provider-safe 名称只允许在具体 provider 请求边界临时
  编解码，不能进入注册表、权限、事件或历史记录。
- `velar-desktop build` 生成带版本、分项字节、完整树 SHA-256、10 MiB 默认硬预算和
  外部 Node >=24 声明的 `.app`。宿主不再绑定构建机的绝对 Node 路径，会在启动时按显式
  绝对 override、绝对 `PATH` 项和可信系统包管理路径无 shell 查找并探测版本；应用配置与
  build manifest 均不再写入构建机 Node 路径或版本。源码构建与六包安装态产物都用 native
  `--smoke` 回归该契约；项目根覆盖也必须是已存在的绝对目录。Lite 当前真实产物约 642 KiB。
- `velar-desktop test` 已成为无窗口主验证入口：通用浏览器交互测试前安装由框架提供的
  确定性、权限感知内存 Desktop 工作区；真实 Swift/Node 边界由独立 integration 与 native
  `--smoke` 验证。Lite 当前 17 个直接 Agent/Desktop Chromium 场景全绿。
- Desktop 已提供 permission-scoped `velar/fs`、`velar/path`、`velar/process`、
  `velar/http`、`velar/env` 与 `velar/desktop`。原生桥曾错误拒绝一切非空参数，现由共享
  `BridgeRequest` 验证并在 smoke 中用带参请求回归。不存在的越权路径也先做词法授权，
  不能伪装成普通 ENOENT。
- 长期语义决定：`velar/process.start -> Promise<Process>` 在 Node/Desktop 统一异步；
  Desktop 不再缩水为仅 `run`，支持持久句柄、`wait`、`stop` 和进程树生命周期。Desktop
  HTTP 不再把最多 64 MiB 正文塞进单条 JSON；响应头先返回，正文 pull-based 分块，真实
  timeout/cancel 一直传到 Node fetch。环境变量按 manifest 白名单在启动时生成只读快照。
- Node/Desktop process 边界再收敛一类真实缺陷：options 现只接受 enumerable own data
  fields，getter/symbol/继承字段/未知字段在启动前拒绝；参数与显式环境各有 1 MiB 聚合预算，
  Desktop worker 独立复验，renderer 也不再信任宿主返回的句柄或结果 shape。只授权 process
  而未授权 files 的合法应用现在从 launch directory 启动；显式 `cwd` 仍必须落在已授权文件根。
  exact executable grant 明确定义为原生程序启动权而非 OS sandbox；Agent 审批、参数策略与
  更强隔离属于消费产品，不能错误塞进 `@velarscript/*`。
- Node/Desktop filesystem 边界关闭一组 symlink 与 test-seam 缺陷：Desktop 旧 worker 会把
  指向根外不存在目标的 dangling symlink 当作普通新文件，`writeText/appendText` 因而可能
  沿链接越权写入；`removeFile/move/info` 又错误 canonicalize 最终链接并操作目标。现内容
  操作跟随且校验 canonical target，entry 操作只处理最终目录项，dangling link 永不等同于
  absent target。递归 `makeDirectory` 会从最近已有祖先安全创建，`list` 恢复 2 MiB 名称预算，
  Node/Desktop 对目录 write/append 与非普通 copy source 给出同类错误。renderer、真实 worker
  和 deterministic test host 都独立验证路径、byte/item/text budget 与返回 shape。
- Node/Desktop path 与 Desktop host-state 边界不再把 JavaScript 对象当作可信 Vel 值：
  `join/resolve` 的 parts 必须是 dense、enumerable own data `List<string>`，getter 与 sparse slot
  均不执行并直接拒绝；每个输入和最终合成结果都受 4,096 code-unit 上限约束，不能靠许多
  单独合法的片段制造超长路径。Desktop 的 platform/packaged/invoke/projectDirectory/
  environment 也只从 own data descriptor 读取；native home/app-data/project 返回必须是有界
  绝对路径。环境快照在 Swift host 与 renderer 两侧独立限制为最多 64 项、每值 64 KiB、
  名称加值合计 1 MiB，accessor/symbol/非文本字段不会进入 Vel。稀疏 List、恶意 getter、
  超长合成路径、65 项/单项/总量超限快照及 Swift 名称计费规则均有回归。
- 同一个 `velar/path` 契约曾在 macOS Node 与 Desktop 上产生不同结果：Desktop 会先
  normalize 再做 `dirname/basename/extension`，导致 `dirname("foo/..")` 从 Node 的
  `"foo"` 漂成 `"."`，`extension("..")` 甚至错误返回 `"."`。Desktop 现实现完整 POSIX
  词法语义并保留 trailing/duplicate separator 规则；611 个路径、376,376 次 normalize/
  dirname/basename/extension/isAbsolute/relative 差分全部与 `node:path.posix` 一致。两端自己
  控制的 List/字符串/descriptor 验证操作也在模块初始化时捕获，不再被事后替换重定向。
- Node `velar/serve` 与 `velar/terminal` 的宿主边界完成同类收敛。`ServeRequest`、
  `ServeResponse`、`Server` 的运行时 Type 现在只检查 enumerable own data descriptor，
  不执行 getter/symbol/集合 override；并修复了合法 `ServeRequest.is` 曾返回 Map 而不是 bool
  的真实契约错误。request `json()` 与 response `json` 统一复用 compiler strict JSON，
  `1e400 -> Infinity`、accessor/extra-field/sparse List 和非有限响应均拒绝。Terminal 的
  queued input 受 256 行/1 MiB 窗口约束并通过 Promise 交付，超长行不再从 readline event
  逃逸崩进程；`close()` 即使发生在首次读取前也永久关闭，后续 `readLine()` 稳定返回 null。
  hostile Type、真实 HTTP 请求、纯 Vel CLI close/overflow 生命周期均有执行回归。
- Runtime Type registry 不再由 compiler emitter、Web、CLI 标准模块和 Node `serve`
  各自复制初始化逻辑。`runtime-abi.ts` 现单点拥有 `VELAR_TYPE_REGISTRY_KEY`，新的
  compiler-owned `VELAR_TYPE_REGISTRY_RUNTIME` 统一 immutable descriptor 校验、WeakSet
  brand 检查、intrinsic add/has 与错误语义；boundary guard 会扫描 compiler/Web/Node/CLI，
  禁止再次硬编码 registry key 或 reactive runtime schema。accessor、writable/configurable、
  非 WeakSet 和 instance `.add` poisoning 均 fail closed 且不执行 hook，Core/Web/Node
  extension 的真实模块共享同一注册表。
- Node `velar/host` 不再允许 graceful shutdown 无限挂起：最多注册 1,024 个 cleanup，
  SIGINT/SIGTERM 后按注册顺序共享 30 秒总 deadline；reject、非 null 返回或超时选择 exit 1，
  deadline 到期停止等待，第二次信号仍立即强退。使用缩短 deadline 的真实子进程 SIGTERM
  回归验证 stuck Promise 会退出而不是永久存活，正常有序 server cleanup 仍保持原语义。
- Lite 产品路径已独立重写为一个纯 Vel Desktop 项目，不与 VelarOS Desktop 共用产品源码、
  Agent、工具、状态或业务实现，也不再经 localhost `/api/chat`。它只像任意外部应用一样
  消费通用 `@velarscript/desktop` 目标能力；其产品侧 Agent 编排不得反向进入
  `@velarscript/*`。
  旧的 Workspace 公共模型与 `workspace_*` 别名已 clean-break 删除，统一为 VelarOS
  `namespace:tool` 身份；Lite 使用诚实自有的 `lite:*`，不冒充 Platform 已有命名空间中
  语义不同的工具。provider-safe `namespace__tool` 只在单次请求边界存在并立即解码。
- `@velarscript/desktop` 的通用文件能力不再使用 VelarOS 产品历史词汇：公开 manifest
  scope 已从 `system-workspace/project-workspace` clean-break 为 `app-data/project`。
  `appDataDirectory()` 与 `projectDirectory()` 仍是普通桌面应用路径 API；它们不定义 Agent、
  ToolRegistry 或 VelarOS Workspace 模型。
- 清理两个混入 npm workspace 的测试性 demo 包：`@velarscript/demo-format` 与
  `@velarscript/demo-web-kit` 已从源码树、lockfile、示例依赖和构建清单删除。Web 示例改为
  自包含纯 Vel 组件/格式化逻辑；正式工具链目录现在只有六个发行包。
- Desktop HTTP 现逐跳校验重定向 origin（最多 20 跳），跨 origin 清除敏感头；原生桥改为
  有总量上限的双向分块协议，公开的 16 MiB 文件、进程输入和 HTTP body 契约不再被旧
  1 MiB transport 假上限截断。真实大载荷、重定向逃逸与桥脚本重组均有执行测试。
- Lite 已把 create、exact-text replace 与无 shell run 接入同一套可恢复审批状态机。每个
  effect 在执行前单独暂停，Allow once/deny 均先写入受保护的 append-only NDJSON journal；
  重启会把内存中未决审批收敛为 cancelled，`.git/.ssh/.aws/.velaros` 等任意祖先段均不能
  被 Agent 精确路径绕过。命令还需同时命中 Desktop manifest 的 exact executable grant。
- Node/Desktop `velar/http` 新增通用 `secretHeader`：Vel 代码只携带环境变量名和前缀，
  密钥由能力宿主在请求开始时注入。Desktop 的 `secrets` grant 与 renderer 可读的
  `environment` 强制不相交，跨 origin 重定向删除全部 secret-derived header。Lite 的
  Responses adapter 已去掉原始 API key 字段；设置 `VELAROS_LITE_MODEL` 时使用宿主侧
  `OPENAI_API_KEY`，未设置时保持确定性 Demo。
- Node/Desktop HTTP 审计关闭一类跨目标 lossless JSON 裂缝：旧 Node/Desktop
  `response.json()` 会把 `1e400` 静默接成 `Infinity`，Node 请求体还会把 Map 序列化为
  `{}`，Desktop bridge 会在权限宿主前触发 options/body accessor。两目标现复用 compiler
  的严格 JSON runtime；请求 options 只从 enumerable data descriptor 快照，非文本 body
  在 dispatch 前验证并序列化，Desktop worker 只接收已验证文本并拒绝未知 wire 字段。
  Node、Desktop renderer 与隔离 worker 的真实回归均覆盖失真响应、Map/accessor 请求体、
  非法 worker 直调和合法 JSON content-type 注入。
- Node/Desktop HTTP 响应边界现与 Web 收敛：Node 只接受并一次性快照原生
  `Response`/`Headers`/byte stream，Desktop renderer 不再信任 bridge 返回的元数据或 chunk
  形状；三目标除 `maxBytes` 外统一限制最多 1,000,000 个源分块，零字节无限流也会终止。
  Desktop 204/HEAD 等无正文响应在响应头到达时立即释放 worker handle 和 renderer timer。
  恶意 accessor 响应、101 个响应头、畸形 bridge record、零字节病态流与真实 204 句柄释放
  均有执行回归。元数据拒绝路径会主动取消已经取得的 body/worker handle；Desktop
  request 的 method 与绝对 HTTP(S) URL 也改为创建时校验，worker 在网络 effect 前重复
  同一 token/URL 防线，不再比 Node 晚到 `response()` 才失败。
- 六包产物图复核删除了 `@velarscript/desktop` 未使用的直接 `esbuild` 声明；构建器所有权
  仍在其调用的 `@velarscript/cli`，Desktop 只声明自己源码实际导入或执行的包。安装后
  manifest 验收永久断言该重复边不存在。当前 source map、Swift host 源码与 Node worker
  均是调试/构建所需内容，没有把测试或已删 demo 带入 tarball。
- Web HTTP 再关闭一组与 Node/Desktop 分叉的 lossless/lifecycle 缺陷：旧 `text()` 与
  已缓存 bytes 后的 `streamText()` 会用 U+FFFD 修复非法 UTF-8，而直接流式读取会拒绝；
  普通 `bytes()` 遇到非 byte chunk、宿主 API 缺失或元数据失败时也可能不取消流。现三目标
  的 text/JSON 均要求严格 UTF-8，Web 所有响应拒绝路径统一取消 owned body；请求头 token
  与单行值在 fetch 前校验。公开 `HttpError` 和响应元数据的类型/预算错误也统一为
  TypeError/RangeError。非法 UTF-8（含先 bytes 后 streamText）、畸形 chunk 取消、超量响应头
  body 取消、非法请求头零 fetch 均有执行回归。
- compiler strict JSON 继续收敛为唯一解析/序列化 owner：`velar/json`、Web/Node/Desktop
  HTTP、Node serve、browser storage 与 IndexedDB 都使用模块初始化时捕获的 host
  parse/stringify intrinsic，后续 JavaScript 篡改 ambient `JSON` 不再改变官方模块语义。
  IndexedDB 读写均经过 JSON clone，外部 JavaScript 塞入的 Map/Date 等 structured-clone
  值只能触发 typed fallback；`storage.watch` 只读取原生 browser getter 或 enumerable own
  data 字段，synthetic accessor event 不会执行 getter。异常 close 或 transaction 创建失败
  会丢弃死连接并在下一次操作重新 open。hostile event/JSON patch/foreign DB value/commit 与
  reconnect 均有执行回归，production-web 的真实 session watch 和 database 流程已通过
  Chromium、Firefox、WebKit 27/27。
- Web host-event ABI 现完成同类收敛：Link、media query、生成事件 modifier 与 realtime
  不再直接信任事件 accessor 或连接实例方法。框架在模块初始化时捕获原生 Event、
  WebSocket、EventSource 与对应 prototype 操作，只允许原生 getter或 enumerable own data
  字段进入框架控制流；synthetic accessor、实例覆写与事后替换 ambient constructor 均不会
  被执行。Realtime close reason 使用自有 UTF-8 字节计数，`sendJson` 先验证参数再检查连接
  状态，监听安装失败会关闭已创建资源。恶意 WebSocket/EventSource/event 回归与真实
  keyboard/input/pointer browser event 已覆盖，production-web 三引擎矩阵增至 27/27。
- Web browser-platform ABI 继续收敛 `velar/browser` 与 `velar/web`：Location 的
  unforgeable 实例 getter、Navigator/Document/MediaQueryList/DOMRect/dialog getter，
  EventTarget、History、URL/URLSearchParams、timer、animation frame、window operation
  与导航 dispatch 均在模块初始化时捕获。事后替换 ambient global、实例方法或 own accessor
  不能劫持 snapshot、observer、layout、dialog、scheduler 或 router；原生操作自身抛出的错误
  仍原样保留，不会错误回退到实例 override。Web reactive flush、`tick()`、错误上报 microtask
  与 `Date.now` 也使用 runtime 初始化时的捕获值。hostile post-initialization poisoning 回归、
  三引擎 WebIDL descriptor 实测和 production-web 27/27 均通过；runtime boundary ledger 现为
  34 条。
- Web storage-host ABI 进一步把 local/session storage area、Storage getter/method、同页
  CustomEvent dispatch、全局 storage listener，以及 IndexedDB factory/request/database/
  transaction/object-store/DOMStringList/EventTarget 全链路纳入模块初始化时捕获。事后替换
  global、修改 prototype、给实例塞 shadow method/accessor 都不能重定向官方存储语义；
  request 与 transaction 回调中的同步异常也会转成 owned rejection，不会逃逸或留下悬挂
  Promise。完整 fake-WebIDL poisoning、commit/abort/reconnect 回归和真实三引擎数据库流程
  均通过，boundary guard 会拒绝重新出现的直接宿主访问。
- Desktop host ABI 现按同一原则收敛：`velar/desktop`、fs、path、process、HTTP、env 在
  模块初始化时捕获 bridge identity、own data-valued invoke 与各自 snapshot，事后替换全局
  bridge 不再重定向能力。WKWebView 注入 transport 也在应用 JavaScript 前捕获 JSON、编码器、
  Map、timer、Promise、typed-array 与原生 message handler。`velar/desktop-test` 因每个测试
  都更换独立 Page，刻意按调用读取一个 data-only controller snapshot，避免保留上一测试的
  authority；全量 Lite 曾抓到“过早捕获导致测试宿主未安装”的失败，修正生命周期后 17/51
  浏览器场景恢复全绿。hostile global/prototype/transport poisoning、large bidirectional chunk、
  Node worker 权限和 package smoke 均通过。
- Lite 的精确文本替换暴露出通用语言缺口：过去只能用 `split(oldText).size == 2` 判断唯一
  occurrence，会分配完整 List。Core 现增加编译器所有的 `string.count(text)`，使用非重叠
  occurrence 语义，空搜索按 Unicode code-point 的 `size + 1` 个位置计算；类型检查、named/
  first-class method lowering、semantic members、runtime 与宪章使用同一契约。Lite 已改用该
  API，而没有在产品层保留 workaround。
- Lite 的 `ChunkStream` 又证明手写首轮 `await` + `while` 是可重复的语言摩擦。Core 现提供
  原生 `async for value, index in source`，只接受显式 `next() -> Promise<T?>`：source 与 own
  data-valued `next` 各捕获一次，每次必须返回 actual Promise，`null` 结束、rejection 保留，
  第二槽为零基 pull index；`continue` 先推进 index，`break` 不多拉取，也绝不暗中调用 cleanup。
  运行时在模块初始化时捕获 Object/Reflect/WeakMap/Promise intrinsic，accessor `next`、magic
  thenable 与事后原型污染均 fail closed。parser 对 JavaScript `for await` 给唯一迁移指引；
  formatter、跨模块 class contract、控制流与 hostile ABI 均有执行证明。Lite 已直接采用，
  generators/`yield`/`Symbol.asyncIterator` 仍保持缺席。runtime boundary ledger 增至 35 条。
- Lite 继续验证异步链路时暴露出 native Promise 的表示限制：若 resolved value 顶层带 callable
  `then`，JavaScript 会把它当 thenable 吸收，旧编译结果可能永久 pending。Core 现以 `VEL4024`
  拒绝显式 `Promise<T>`、async def/method/action/arrow、泛型实例、call/await 与 async intrinsic
  中已知的 callable `then` data member 或任意 `then` getter；`then: string` 与
  `Promise<List<Box>>` 这类嵌套形状保持合法。`velar/async` 同时改为初始化时捕获 Promise、
  timer、Number、Reflect/Object 与 dense-List ABI，不调用输入 List 的 `map`/`some`/iterator，
  `map`/`series` 的同步回调可安全收集 then-shaped 元素，`retry` 的动态冲突 fail closed。
  后续对抗复核又确认只检查签名仍会被 `unknown`、无 `then` 基类或跨模块接口拓宽绕过：
  具体返回对象可带隐藏 getter/method 并重新让 Promise 永久 pending。Analyzer 现同时检查每个
  async return 的实际类型；emitter 在 native adoption 前用初始化时捕获的 descriptor/prototype
  ABI 检查拓宽后的真实值。跨模块隐藏 getter 回归稳定 `TypeError` 且 getter 读取为 0，正常
  actual-Promise adoption、非 callable `then` data 和嵌套 List 均保持原语义。
- Web/Node/Desktop HTTP 请求预算现统一按实际 UTF-8 传输字节计量，而不是 Web 的 UTF-16
  code unit 与 Node worker 的 `Buffer.byteLength` 各自决定。新增 compiler-owned、零宿主依赖的
  UTF-8 计量 runtime，捕获 String code-unit 与 Reflect apply intrinsic，并明确覆盖 surrogate
  pair 与 unpaired surrogate；多字节纯文本、序列化
  JSON 和 Web form 字段都在任何 Fetch/bridge effect 前检查。Web 的 JSON body 改为 lazy
  Request 创建时即严格序列化并快照，之后修改原对象不会改变请求；自动补入的
  `content-type` 也必须落在合并后的 100-field/64-KiB header 上限内。四个聚焦测试文件共
  418 项已通过；随后 `npm run check`、465/465 全量 compiler/runtime、四示例、
  27+6+15+6 三浏览器场景、安装浏览器验收、六包 consumer/rehearsal、独立 Lite 全门禁及
  Workbench 安装态验收全部取得 exit 0。
- 同名 HTTP API 的下一轮差异审计补齐 Node/Desktop 缺失的 request/response `parse(Type)`，
  并把异步 runtime Type 推断下沉为 Core 通用 intrinsic；Web 不再独占一份 `http.parse`
  analyzer 特判。三目标运行时复用 compiler-owned Type registry，在任何请求 effect/正文消费前
  拒绝伪造 Type；返回类型若顶层含 callable `then`，编译器以 `VEL4024` 阻止 native Promise
  assimilation。Web 原先默认永不超时、接受小数且允许到 2,147,483,647ms，也与 Node/Desktop
  收敛为默认 120,000ms、只接受 0–600,000ms 整数、`0` 显式关闭。目标专属的 Blob/form、
  browser credentials/cache、host secret 与 absolute URL/权限策略继续保持各自能力边界。
  默认 timeout 收敛同时暴露出三套 Request 共有的取消泄漏：abort error 分支会在 `finish()`
  前抛出，Web 过去因默认无 timer 而掩盖。现 cancel 立即 clear/null owned timer，所有请求
  failure 先 finalize 再归一化错误；边界守卫要求三目标同时保留 completion/cancel 两条释放路径。
- 入站服务端 JSON 现补齐 `ServeRequest.parse(Type, maxBytes=16777216) -> Promise<T>`，不再要求
  应用手写 `text() + tryParse()`。它复用 Core 的 `runtime.parseAsync` 推断、compiler-owned Type
  registry 与 strict JSON；伪造 Type 在读取正文前失败，正文仍只读一次并缓存，超限继续抛
  `RequestBodyTooLargeError`，malformed JSON、结构类型失败与 callable `then` 各自保留明确错误。
  Lite 服务端已直接采用该 API，完整 32+28、17/51 浏览器与 package 门禁通过；安装包消费
  也检查发布后的 Node runtime 确实携带该契约。运行时边界账本增至 38 条。官方包边界复核
  未发现 Agent/demo 实现回流，并修正 CI 文档残留的旧 Agent/七包表述为当前六包发布集合。
- Core 现补齐 first-class `Type<T>` 静态载体，纯 VelarScript 包可直接声明
  `decode<T>(value: unknown, target: Type<T>) -> T` 并调用统一的 `target.is/parse`，不再依赖
  compiler-private intrinsic。record、透明 alias、enum、泛型替换、模块接口、re-export、重命名
  import、namespace import 与 semantic index 共用同一目标类型传播链；透明 alias 仍保留用户写下
  的显示名，同时按底层 callable/collection 契约工作。普通结构对象不能伪造 `Type<T>`；由于
  runtime registry 只证明 Type 对象归属、不具化泛型目标，`is Type<T>` 及把它嵌入运行时验证
  的 `type` 会以 `VEL4022` 明确拒绝。边界账本增至 39 条，`npm run check`、466/466、四示例、
  完整三引擎浏览器、安装包 consumer、release rehearsal、独立 Lite 全门禁和 Workbench 安装态
  验收均已通过。
- Lite 的事件协议暴露出 record union 缺少可表达判别关系：旧 `AgentEvent` 把所有字段做成
  optional，再用运行时代码重建 `kind` 与载荷的不变量。Core 现增加 nominal enum singleton
  type（`EventKind.text`），并把它贯通到 record/alias/union、跨模块 enum identity、重命名
  import、semantic definition、formatter 与 runtime Type validator。union 只暴露所有变体共有
  的字段；`==`/`!=`、`assert`、`match event.kind` 和结构化 `match event` 会同步收窄稳定 owner。
  若不同变体要求不同字段类型，未收窄 union 上的写入会被拒绝，避免只改 tag 而没有重建
  payload。Lite 已改为九个具体事件 record 的 union，删除 null 占位与大部分手写组合校验；
  普通无上下文聚合与未标注 `let` 会把 singleton 拓宽回所属 enum，避免把可变业务数据误锁
  为一个成员；显式 record-union 上下文仍用判别字段选择精确变体。最终门禁为
  `npm run check`、467/467 compiler/runtime、四示例 check/test、完整 Web 三引擎矩阵、
  六包安装消费与 release rehearsal、Workbench 安装态验收，以及 Lite 32 shared +
  28 server、17 Chromium / 51 三浏览器 Desktop、package acceptance 与构建全部 exit 0。
- Lite 的真实 Responses SSE 继续暴露出外部协议 tag 无法进入 enum：
  `"response.output_text.delta"` 含点号，不能作为 VelarScript 成员名，provider adapter 因而仍用
  一个大 optional record 手工恢复事件形状。Core 现允许 enum 成员映射一个唯一的 inline
  string runtime value，例如 `textDelta = "response.output_text.delta"`；类型身份仍是名义化的
  `ProviderEventKind.textDelta`，未映射成员保持原语义，不引入 TypeScript 式结构化 literal type。
  enum runtime `is/parse` 同时从可污染的 `Array.prototype.includes` 改为生成严格相等链。
  Lite 采用宽松 envelope 保留未知 SSE 事件的前向兼容，对十类已知事件则用映射 enum +
  精确 record `Type<T>` 解码，删除无关 optional 组合。最终门禁为 `npm run check`、468/468、
  四示例、完整三引擎、六包安装消费/rehearsal、Workbench 安装态，以及 Lite 全门禁全部
  exit 0。
- Lite 的动态工具 schema 进一步证明 fixed record 与 `Map<string, T>` 之间缺少一种
  JSON-owned 数据形状。Core 现增加 invariant `Record<T>`：它表示 plain object 的动态
  string key，索引读取为 `T?`、写入为 `T`，拥有受控的查询、变更、快照与双槽遍历 API；
  `Type<Record<T>>` 在不调用 getter 的前提下拒绝非 plain prototype、symbol、accessor、超量
  field 与错误 value。strict JSON 递归接受 Record，但继续拒绝 Map，因此没有把 wire object
  和 native collection 混成一个概念。类型传播已贯通 alias、nominal、跨模块 rename、package
  interface、semantic index 与 runtime Type；CLI project 的三条变换链也有边界守卫。Lite 的
  tool schema、provider request/input/tool/continuation 已改为精确 Record/union，app、CLI、server、
  shared 的 VelarScript 协议源码不再显式声明 `unknown`。
- 全量回归同时抓到并关闭一个 CLI 生命周期竞态：声明文件重编译尚未完成时收到 SIGTERM，
  旧关闭流程会先清空 package watcher，随后 in-flight rebuild 又把 watcher 注册回来，导致
  HTTP server 已关闭但进程不能退出。dev server 现拥有明确 closing state，会取消 pending
  timer、拒绝新 rebuild 调度和 watcher 复活；原失败集成场景恢复为首个信号自然退出。
  最终门禁为 `npm run check`、469/469 compiler/runtime、四示例 check/test、完整开发/生产/
  external-preview 与三引擎 browser 矩阵、六包安装消费/rehearsal、Workbench 安装态，以及
  独立 Lite 的四项目 check、32+28 tests、package acceptance、17 Chromium / 51 三浏览器
  Desktop 场景和 production build，全部 exit 0。运行时边界账本现为 40 条。
- 对新 Record 的 hostile 复核随后发现可变性证明不完整：早期 `Type<Record<T>>` 会接受
  frozen、sealed 或 read-only host data property，而静态类型同时承诺 `set/remove/clear` 与
  bracket assignment；直接索引还可能只看目标 field，漏过同一对象上的 symbol/accessor。
  Core 现与 List 使用同一原则：runtime Type、索引和所有方法都先证明整个对象由 writable、
  configurable、enumerable own data fields 构成，再执行单键操作。hostile emitted-JS probe 与
  packed cross-package consumer 均证明 frozen/sealed/read-only/symbol/accessor/inherited/wrong-value
  输入在不调用 getter 的情况下 fail closed。最终全量仍为 469/469、四示例、完整三引擎、
  六包安装消费/rehearsal、Workbench 安装态及独立 Lite 全门禁全部 exit 0。
- 扩展包依赖图的删除路径复核发现 orphan manifest-field 缺陷：项目只直接激活 child
  capability、由 child 继承 application parent 时，删除最后一个 child 只会清理 child 的配置，
  parent 已不在激活图中却留下其 manifestKey；随后的项目解析把该字段视为 unknown，并在 npm
  已改变依赖树后让命令失败。package manager 现从剩余 direct extensions 重算旧语义图的可达
  闭包：被删除节点和不再可达的 inherited parents 共同清理，仍由另一个 child 共享的 parent
  及配置保持不动。npm 继续独占版本、安装、lockfile 与完整性，VelarScript 只维护 compiler/
  runtime composition。remove 同时改为 staged manifest transaction：先验证当前项目，再在包
  尚完整时写入并解析候选 `velar.json`，最后才执行 npm；npm 失败恢复原文，npm 成功后若外部
  包状态异常则保留已验证的候选声明，不再回滚为引用已删除包的旧图。add 仍保持安装后验证、
  无效扩展不激活。新增对抗回归覆盖 shared-parent、last-child、npm failure restoration 与
  invalid-project preflight；最终
  `npm run check`、470/470、四示例、六包安装消费/rehearsal、Workbench 安装态及独立 Lite
  四项目 check、32+28 tests、package acceptance 全部 exit 0。
- 同类复核继续删除 CLI 包命令中漂移的第二套扩展元数据解析器：过去项目解析允许省略
  空 `extends`，但 `velar add/remove` 会错误拒绝；npm 子进程若假成功却没有可解析安装物，
  add 还会误报成功。现在安装识别与 extension graph 共用唯一 reader，合法省略语义一致，
  请求包不可解析时 fail closed；回归同时覆盖无 `extends` 扩展的 add/remove 与假成功 npm。
  当前 `npm run check`、470/470、四示例、六包 consumer/rehearsal、Workbench 安装态与独立
  Lite 四项目 check、32+28 tests、package acceptance 均再次取得明确 exit 0。
- 扩展字段所有权对抗又证明 `manifestKey` 可以错误抢占 Core 的 `entry`/`extensions`；remove
  可能因此删除入口声明，`constructor` 还会在配置缺失时从普通 JSON 对象原型链读出宿主
  函数。Core 项目字段现由 `project-format.ts` 单点声明，extension metadata 在导入任何扩展
  代码前拒绝 Core 字段及宿主对象保留键；项目解析与 `velar add` 都有定向回归。
- 包事务并发复核发现 npm 运行期间的编辑器写入可能被 add 候选覆盖，remove 失败恢复也会
  把新内容回滚成命令启动时旧快照。所有 stage/restore 现先比对命令实际读取的完整原文，
  只在仍匹配时原子替换；出现并发修改则保留新声明并报告冲突，不以事务之名丢用户数据。
- 受保护写入继续补齐序列化尺寸前置检查：接近 1 MiB 的合法紧凑 manifest 过去可能被
  pretty-print 膨胀成超限候选，先写坏再无法恢复。CLI 现于 stage/npm 之前按最终 UTF-8
  字节拒绝超限结果，并永久回归原文不变、npm 未调用。字段所有权、并发保护与尺寸边界
  收敛后的当前证据为 `npm run check`、470/470、四示例、六包 consumer/rehearsal、
  Workbench 安装态，以及独立 Lite 四项目 check、32+28 tests、package acceptance 全部 exit 0。
- 扩展版本契约审计发现自写正则既拒绝合法 SemVer 2.0 build metadata，又接受前导零与空
  identifier；`apiVersion` 也接受 `01.0` 这类非规范身份。扩展包版本现完整遵循 SemVer 2.0，
  API major/minor 禁止前导零并受长度边界；npm 仍独占 dependency/peer range 求值，不在
  VelarScript 内复制一套不完整的 npm range 语义。
- 扩展安装解析再发现 nearest-package 身份漂移：最近候选的 `package.json` 若是目录、符号
  链接或读取失败，旧实现会吞掉异常并继续加载祖先同名包。现在只有 ENOENT/ENOTDIR 才
  继续 Node 搜索顺序；已存在但非普通文件或不可读的最近 manifest 一律 fail closed，嵌套
  `node_modules` 对抗夹具证明不会被祖先扩展替身接管。版本与安装身份收敛后的当前证据为
  `npm run check`、471/471、四示例、六包 consumer/rehearsal、Workbench 安装态，以及独立
  Lite 四项目 check、32+28 tests、package acceptance 全部 exit 0。
- 同类 nearest-owner 审计扩展到项目发现：旧 `pathKind` 把全部 stat 错误视为 missing，局部
  `velar.json` 是目录、坏链接或不可读时可能越级套用祖先项目；compiler 又接受 symlink
  manifest，而 package manager 拒绝。现在只有真实缺失才向上搜索，最近 manifest 必须是
  普通文件，check/build/test/LSP 与包命令共享同一项目身份；目录与 symlink 均有回归。
  当前 `npm run check`、472/472、四示例、六包 consumer/rehearsal、Workbench 安装态，以及
  独立 Lite 四项目 check、32+28 tests、package acceptance 全部 exit 0。
- Lite 的 Markdown 内联解析继续暴露出基础文本定位缺口：语言已有 code-point `size/char/slice`，
  却没有从指定位置查找 literal text 的成员，产品只好用 `slice` 手写逐字符扫描。Core 现增加
  `string.index(text, start=0) -> number?`；结果与 start 均使用 Unicode code-point 位置，负 start
  从末尾计数、越界 clamp、缺失返回 `null`，named 与 first-class method lowering、semantic member
  和 JavaScript `indexOf` 迁移指引使用同一契约。审计同时发现 `velar/text.findMatch/findMatches`
  过去把 JavaScript UTF-16 offset 公开成 `index`，导致 emoji 之前的匹配位置不能直接交给
  `.slice()`；公开 match index 现统一为 code point，replace/split 的 UTF-16 cursor 只留在模块内部。
  编译器文本 runtime 也改为捕获的 code-unit 操作推导位置，不依赖可替换的 ambient
  `String.prototype.indexOf`，并拒绝落在 surrogate pair 中间的 literal match。Lite 删除本地
  `findDelimiter`，两处流式 decoder 也改用已有 `List.pop()`，没有为产品新增专用 API。
  当前证据为 `npm run check`、472/472、四示例、完整三浏览器、六包 consumer/rehearsal、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 浏览器
  场景与生产构建全部 exit 0；runtime boundary ledger 现为 41 条。
- Web、Node 与通用 Desktop HTTP 的同名 API 对抗审计发现响应元数据契约不闭合：公开
  `HttpError` 只接受 100–599，但 Web/Node 快照过去允许 `Response.error()` 的 status 0，
  使无效宿主响应先进入类型化响应、随后以无关 `RangeError` 失败；Desktop renderer 还会
  分别信任 bridge 提供的 `ok` 和 `status`，因此可接受 `ok: true, status: 500` 这类矛盾记录。
  三个官方目标现统一要求 status 为 100–599 的整数，且 `ok` 必须精确等价于 200–299；
  status 0 和矛盾 metadata 在 `HttpError`、body read 或流所有权转移之前以边界 `TypeError`
  fail closed。目标专属 URL、credentials、secret 与权限策略保持独立，没有为表面一致性
  抹平能力差异。公开构建入口也已复核不再携带旧 status-zero 例外。
  当前证据为 `npm run check`、472/472、四示例、完整开发/生产/外部预览与 27+6+15+6
  三浏览器矩阵、六包安装消费/rehearsal、Workbench 对新 rehearsal 的安装态验收，以及
  独立 Lite 的四项目 check、32+28 tests、package acceptance、51/51 三浏览器场景与生产
  构建全部 exit 0。Lite 没有引入产品专用 HTTP shim；其当前构建为 765,201 bytes
  （747.3 KiB），SHA-256 为
  `cd860f20ef84a4acf7d4673754c46fdf47da74e02b40f79b7e77be429e50a64b`。
- 同一 HTTP 状态机审计随后发现 Node 的“惰性请求”在构造阶段提前解析 `secretHeader`：
  `http.get(...)` 尚未开始网络请求就读取 `process.env`、把密钥值写入内部 headers，并让
  缺失值以同步构造异常暴露；这与文档和 Desktop host 的“请求开始时解析”契约相反，
  也使创建请求后的密钥轮换无法生效。Node 官方 runtime 现把 descriptor validation/snapshot
  与 secret resolution 分开：构造阶段只保留 frozen descriptors，首次 response/body effect
  才在局部 headers 副本中读取当前环境值；缺失 secret 会以异步请求失败阻止 Fetch，密钥值
  不进入惰性 Request 状态。hidden/non-enumerable List entry 也不能伪装合法 descriptor。
  真实公开包探针证明创建值 `created-value` 被启动前的 `started-value` 替换，且缺失值只在
  start 阶段失败。当前门禁为 `npm run check`、473/473、四示例、完整开发/生产/外部预览
  与 27+6+15+6 三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite
  四项目 check、32+28 tests、package acceptance、51/51 三浏览器场景与生产构建，全部
  exit 0。Lite 没有增加 secret workaround，VelarOS Desktop 产品仍未参与或被修改。
- 响应生命周期继续复核发现两项同类漂移。第一，上一轮 status/`ok` 收敛只覆盖 Web、
  Node 与 Desktop renderer，隔离 Node capability worker 仍允许 status 0 且未校验 `ok`
  与 2xx 一致；renderer 会二次拒绝，所以应用未放行，但第一道宿主边界不完整。worker
  现独立执行同一 100–599 + 精确 2xx 规则，边界 guard 永久禁止旧例外复活。第二，Web
  已让并发 `text/json/blob` 共享一次 pending byte read，Node/Desktop 却让第二个 buffered
  reader 报 “body already being consumed”。Node 与 Desktop renderer 现各自拥有单一
  pending text read：并发 `text/json/parse` 合并读取，成功结果缓存并可重复读取；
  `streamText` 继续独占，避免隐藏缓冲和背压。公开 Node 包的并发 `text()+json()` 实际
  探针、Desktop bridge pull 数与 Web 回归共同锁定语义。
  当前证据为 `npm run check`、475/475、四示例、完整开发/生产/外部预览与 27+6+15+6
  三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite 四项目
  check、32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部 exit 0。
  Lite 当前构建为 765,431 bytes（747.5 KiB），SHA-256 为
  `5e83361e3adf880c022c859d017cf316eab579b0401f0a5942844bdb932311e1`。
- HTTP 响应预算的同类对抗随后证明 `maxBytes` 仍只按实际读取字节生效：Web buffered
  reader 会利用 `Content-Length`，但 Web `streamText`、Node 与 Desktop capability worker
  即使已收到合法且明确超限的长度，仍会先开始消费正文。三个官方目标现统一在第一次
  buffered/streaming body read 前检查有效十进制 `Content-Length`；声明值超过 `maxBytes`
  时先取消正文并释放请求生命周期，再抛出 `RangeError`，未知、无效或谎报偏小的长度仍由
  实际字节计数兜底。`HEAD` 及真正 bodyless 的响应不会因表示长度而误报超限。
  当前证据为 `npm run check`、475/475、四示例、完整开发/生产/外部预览与 27+6+15+6
  三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite 四项目
  check、32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部 exit 0。
  Lite 不含目标专用补丁；当前构建为 765,754 bytes（747.8 KiB），SHA-256 为
  `7e569f9e58ce6125b5fbbf07f6ffef2062370d37b79f89e31c1c3fae4403619a`。
- 声明长度预检的 hostile-runtime 复核继续发现，Web/Node 在响应创建后仍通过可变的
  `RegExp.prototype.test` 与全局 `Number` 解析 `Content-Length`；应用后期污染原型即可跳过
  上一轮新增的提前取消，Node `ServeRequest` 入站预检也维护着第二套环境可变解析。编译器
  transport runtime 现以初始化时捕获的 `String.charCodeAt`/`Reflect.apply` 提供唯一十进制
  长度解析，Web/Node 出站响应与 Node 入站服务共同消费；隔离 Desktop worker 保持同算法和
  自有捕获。真实污染探针证明后期改写 regex/string/reflect 仍得到 `RangeError` 并取消正文。
  初次全量还抓到 `velar/serve` 只引用 helper 却漏注入其 runtime 的生成模块缺陷；模块注入
  已补齐，boundary guard 现在同时证明引用和随包定义，真实 `velar run` 恢复 413、流与有序
  关停。当前证据为 `npm run check`、476/476、四示例、完整开发/生产/外部预览与
  27+6+15+6 三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite
  四项目 check、32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部
  exit 0。Lite 当前构建为 766,576 bytes（748.6 KiB），SHA-256 为
  `bb071b9a8e78ff22ae193bddc739585dc0d4c2b14a066e53b2ea03f81b03bbad`。
- HTTP 错误身份复核发现 Web、Node 与通用 Desktop 的成功响应都公开重定向后的最终
  `Response.url`，但非 2xx 路径构造 `HttpError` 时仍写入初始请求 URL。跨源重定向到
  502 因而把失败归因给错误端点，影响诊断、审计与按端点恢复。三个官方目标现在统一
  使用最终响应 URL 构造 `HttpError.url` 与 message；只有测试桩等 synthetic response
  返回空 URL 时才回退到初始请求 URL。Web synthetic/final 双路径、Node 真实跨端口
  redirect、Desktop renderer bridge 与真实隔离 worker 均有回归，boundary guard 固化
  三目标 lowering。当前证据为 `npm run check`、477/477、四示例、完整开发/生产/外部
  预览与 27+6+15+6 三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及
  独立 Lite 四项目 check、32+28 tests、package acceptance、51/51 三浏览器场景与生产
  构建全部 exit 0。Lite 没有引入重定向 shim，也未复用或修改 VelarOS Desktop 产品；
  当前构建为 766,584 bytes（748.6 KiB），SHA-256 为
  `e7287123ba8ce7e8f67f6b4110a251ae4aa5c61475a0a13ff2d0ec962d0d755d`。
- Node `velar/http` 的惰性 secret 生命周期继续审计发现，descriptor 虽然已推迟到首次 effect
  才解析，但请求组装仍在那一刻重新读取全局 `fetch`、`Headers`、`URL`、
  `AbortController`、timer 与 collection 方法。模块初始化后加载的 JavaScript 若替换这些
  ambient 对象，就能截获已经解析进 Headers 的 secret 或劫持传输。Node 官方模块现在在
  初始化时捕获 secret-bearing in-process HTTP host ABI；header Map→Headers、redirect clone/delete、
  URL 属性、abort/timer 与 Fetch dispatch 都只使用捕获操作，`Object.fromEntries` secret
  暴露路径已删除。对抗回归先让模块捕获受控 host，再污染全部 ambient 入口，证明轮换后的
  secret 仍只到达原 host、missing secret 仍在 dispatch 前失败且污染入口读取数为 0；
  boundary guard 同时禁止重新出现 live `fetch/new Headers/new URL/new AbortController`。
  当前证据为 `npm run check`、477/477、四示例、完整开发/生产/外部预览与 27+6+15+6
  三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite 四项目 check、
  32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部 exit 0。修复没有
  进入 Lite 或 VelarOS Desktop 产品；Lite 构建身份保持 766,584 bytes（748.6 KiB），
  SHA-256 为 `e7287123ba8ce7e8f67f6b4110a251ae4aa5c61475a0a13ff2d0ec962d0d755d`。
- 同类审计随后发现 Web `velar/http` 的惰性请求也会在首次 effect 时重新读取全局
  `fetch`、`Headers`、`Response`、`AbortController`、timer、`FormData`、`Blob`、
  `TextDecoder` 与 byte-array 构造器；响应快照还直接读取实例字段，允许应用后加载的
  JavaScript 重定向请求组装或让自定义 getter 插入宿主边界。Web 官方模块现在初始化时
  捕获完整的 in-process HTTP host ABI；请求、abort/timer、multipart、buffered body 与
  Fetch dispatch 只使用捕获操作，响应 metadata/body 则通过捕获的原生 `Response`
  prototype accessors 读取，实例 shadow getter 不再执行。测试注入明确移到模块初始化前，
  初始化后的全局 transport/constructor 全量污染读取数为 0；boundary guard 同时禁止
  live `fetch/new Headers/new Response/new AbortController/new FormData/new Blob/new
  TextDecoder/new Uint8Array` 回流。当前证据为 `npm run check`、478/478、四示例、完整
  开发/生产/外部预览与 27+6+15+6 三浏览器矩阵、六包安装消费/rehearsal、Workbench
  安装态，以及独立 Lite 四项目 check、32+28 tests、package acceptance、51/51 三浏览器
  场景与生产构建全部 exit 0。修复只进入 `@velarscript/web`，没有进入 Lite 或 VelarOS
  Desktop 产品；Lite 构建身份仍为 766,584 bytes（748.6 KiB），SHA-256 为
  `e7287123ba8ce7e8f67f6b4110a251ae4aa5c61475a0a13ff2d0ec962d0d755d`。
- W-66 后继续按类别审计发现，Web 的共享 `optionsRuntime` / `listRuntime` 仍在每次调用时
  重新读取全局 `Object`、`Array`、`Set`、`Symbol` 与 `Reflect` 操作；后加载脚本只替换
  `Array.isArray` 就能让 Router、Forms、HTTP、Storage、Files、Realtime 共用的 record/List
  边界整体失效。两个共享 guard 现在于各生成模块初始化时捕获完整 intrinsic ABI；plain
  record 字段发现、allowed-field Set、dense List 验证、reactive iterate key 与 defensive copy
  全部只走捕获操作，allowed fields 也不再用 live `new Set(...)`。HTTP 同类残余的 form name
  去重、file List 副本、byte chunk 收集和 `Object.freeze` 旁路一并清除。对抗回归在初始化后
  污染 Object 的七个静态操作、全局 Array/Set、`Array.isArray`、Set `add/has`、`Symbol.for`
  与 `Reflect.apply`，两个 guard 仍正常且污染读取数为 0；boundary ledger/guard 增至 42 条。
  当前证据为 `npm run check`、479/479、四示例、完整开发/生产/外部预览与 27+6+15+6
  三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite 四项目 check、
  32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部 exit 0。修复没有进入
  Lite 或 VelarOS Desktop 产品代码；独立 Lite 仅因消费更完整的官方 Web runtime 增加
  3,682 bytes（约 0.48%），当前构建为 770,266 bytes（752.2 KiB），SHA-256 为
  `41568c470c73ef549fc5db7ca3349478bdab771d918309be6314a22ba75364d4`。
- Forms 继续作为真实 typed-data 入口审计后发现，既有 descriptor 防护只验证 decoder
  record/List，实际读取仍在调用时重查全局 `HTMLFormElement`、`FormData` 构造器及
  `get/getAll/has`/iterator；后加载脚本替换 `HTMLFormElement` 就能拒绝模块初始化前已属于
  正确宿主的 form，也可改写 FormData prototype 截获提交值。`velar/forms` 现在初始化时
  捕获 form identity、FormData `get/getAll/has/forEach`、结果 Map 和严格十进制解析 intrinsic；
  `Function.prototype[Symbol.hasInstance]` 以捕获调用验证真实 form，不执行构造器自己的
  后置 override。整表读取改用捕获的 `FormData.forEach`，重复字段 List、decoder 遍历、enum
  和 repeated text 验证也删除 live iterator/array helper。对抗回归在初始化后同时替换两个
  全局构造器、HTMLFormElement `Symbol.hasInstance` 与四个 FormData prototype 方法，五次
  value/read 操作仍从原 host 得到一致结果，污染读取数为 0。DOM error/focus/reset/pending 写入
  被明确留作下一独立宿主类别，没有伪称整个 Forms surface 已闭合。当前证据为
  `npm run check`、480/480、四示例、完整开发/生产/外部预览与 27+6+15+6 三浏览器矩阵、
  六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite 四项目 check、32+28 tests、
  package acceptance、51/51 三浏览器场景与生产构建全部 exit 0；runtime boundary ledger
  增至 43 条。修复只进入未被 Lite 导入的 `velar/forms`，tree shaking 使 Lite 构建身份保持
  770,266 bytes（752.2 KiB），SHA-256 为
  `41568c470c73ef549fc5db7ca3349478bdab771d918309be6314a22ba75364d4`，VelarOS Desktop
  产品未参与或修改。
- Forms 的剩余 DOM 生命周期随后证明同一漂移仍存在于 `form.elements`、错误节点查询与
  attribute/text/id、document 创建、focus/reset、控件 name/disabled 及 pending WeakMap；
  初始化后的 getter/prototype/global 替换可以劫持错误呈现或打断禁用状态恢复。Forms 现有
  独立的品牌化 DOM ABI：初始化时捕获 Document/Node/Element/HTMLElement/HTMLFormElement、
  input/button/select/textarea/fieldset/option control getter/setter、HTMLCollection/NodeList 与
  WeakMap 操作。真实 DOM 只调用捕获的 native prototype；显式测试 host 只能提供 enumerable
  own data 字段/方法，accessor shadow 在不执行 getter 的情况下拒绝。所有 live collection
  先按一次 length snapshot 有界复制，pending 在任何写入前验证全部 disabled bool，restore
  使用保存值；ARIA token 解析也改用捕获 regex/array/Map 操作。同字段重复 owned error 过去
  `clearError` 只删第一个、留下幽灵节点与 ID，现一次清除全部并保留无关 describedby token。
  完整 hostile lifecycle 在初始化后污染六类构造器、Node/Element/Form/Document getter/setter
  和方法及 WeakMap prototype，仍完成 setError/errors/focus/pending restore/reset，污染读取为 0。
  当前证据为 `npm run check`、481/481、四示例、完整开发/生产/外部预览与 27+6+15+6
  三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite 四项目 check、
  32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部 exit 0；runtime boundary
  ledger 增至 44 条。Lite 未导入 `velar/forms`，tree shaking 继续保持其构建身份为
  770,266 bytes（752.2 KiB），SHA-256 为
  `41568c470c73ef549fc5db7ca3349478bdab771d918309be6314a22ba75364d4`；Lite 与 VelarOS
  Desktop 产品均无源代码补丁。
- JSX/组件主干继续审计后确认，编译产物与 `velar/web` 各自直接读取 live `document`、
  `Node`、节点 prototype、`Array.isArray`、`Number.isFinite`、`String` 与循环检测 Set；
  后加载脚本可以重定向元素/文本/fragment 创建、mount/destroy、Router/Lazy 或 JSX List
  展开。官方 Web 包现在只有一个 `WEB_DOM_HOST_RUNTIME` 源码所有者，由 emitter runtime
  foundation 和 runtime-implemented `velar/web` 模块分别在初始化时嵌入并捕获各自宿主。
  ABI 覆盖 Document/Node identity、node factories/query、append/insert/remove/before/
  replace/attribute/text 操作、childNodes 有界快照及 DOM 渲染所需 List/Set/number/string
  intrinsic；真实 DOM 走捕获 prototype，显式 fake host 只接受 enumerable own data seam，
  accessor 不会执行。静态 JSX 和 `velar/web` 两个 hostile 回归都在初始化后替换全局
  document/Node、节点 prototype 与集合/数值操作后通过，现有 Lazy、Router、fragment、
  keyed identity 焦点回归也通过，runtime boundary guard 仍为 44 条并把 B-WEB-DOM 提升为
  H+L+R。当前证据为 `npm run check`、486/486、四示例、完整开发/生产/外部预览与
  27+6+15+6 三浏览器矩阵、六包安装消费/rehearsal、Workbench 安装态，以及独立 Lite
  四项目 check、32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部
  exit 0。Look builder 同时改为显式 `velar/look` 命名导入后，Lite 仅在自己的七个 `.vel`
  消费文件声明实际 builder 依赖，没有共享 Desktop 产品代码或增加兼容后门。更完整的
  官方 DOM runtime 使 Lite 当前构建为 800,907 bytes（782.1 KiB），SHA-256 为
  `d19a6c2f44ea3e3d77dc1ac7d4944a87252d4d178348a5c5c4e58dda7b7cbd77`，仍低于 1 MiB；
  VelarOS Desktop 产品未修改。
- Web 响应式主干继续按相同宿主所有权原则审计后确认，共享 dependency/raw-proxy/parent
  图和 emitter 自己的 state/computed/watch observer、flush queue 仍在运行时调用 live
  Set/Map/WeakSet/WeakMap、`Array.isArray`、`Object.is`、Proxy 与 Reflect。模块初始化后只替换
  `Object.is` 就能让第一次 state 写入直接逃逸；集合 prototype 替换也能中断订阅与清理。
  `WEB_REACTIVITY_HOST_RUNTIME` 现在是这一类别唯一的内部 host ABI：每个生成模块初始化时
  捕获构造器、静态操作、collection methods/size getter 和 Proxy traps，dependency tracking、
  deep record、watch comparison、observer cleanup、batch queue 全部只走捕获操作；它不成为
  VelarScript 公共 API，也不复用 DOM ABI。敌对回归在初始化后替换七个全局构造器与 Reflect 对象、
  Set/Map/WeakSet/WeakMap 全部相关 prototype 操作、`Array.isArray`、`Object.is` 与四个 Reflect
  trap，state + deep record + computed + watch + tick 仍得到 `total:3` / `fresh:3`。永久 guard
  阻止 graph-owned emitter slice 重新出现 live collection/Object/Reflect 路径，
  B-WEB-REACTIVITY 从 L+R 提升为 H+L+R，ledger 总数保持 44 条。
  当前证据为 `npm run check`、487/487、四示例 check/Vel tests、完整开发/生产/外部预览与
  27+6+15+6 三浏览器矩阵、六包安装消费/release rehearsal、Workbench 安装态，以及独立
  Lite 四项目 check、32+28 tests、package acceptance、51/51 三浏览器场景与生产构建全部
  exit 0。当前并行 Look 改版也已进入同一工作树，所以不能把相对 W-70 的全部体积变化
  单独归因于响应式修复；最终组合构建为 826,318 bytes（807.0 KiB），host 235,904、renderer
  558,481、capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `873df9fac10a1001b609bc7c4fe4fccb3f0e112bb70c6fab76b776b48d01936a`，仍低于 1 MiB。
  Lite 只作为独立消费者验证公开包，VelarOS Desktop 产品源码未修改。
- 错误通道继续按同一宿主所有权原则审计后确认，Core 的 `__velarNormalizeError` 仍会在
  catch 时重读 live `Error.isError` / `String` / `Error`，Web reporter 与 owned callback 又会
  重读 `Object.getOwnPropertySymbols`、`Object.freeze`、`Number.isFinite`、
  `Promise.prototype.then`，`velar/app` 的 handler Set 操作也直接落到可污染 prototype。
  `VELAR_ERROR_NORMALIZATION_RUNTIME` 现在于模块初始化时捕获 Error 身份/构造、String 与
  Reflect apply；`WEB_ERROR_HOST_RUNTIME` 成为 Web report/owned Promise observation 的唯一
  内部 ABI，并与响应式 graph helper 共同承接 handler Set 操作。初始化后替换这些全局、
  静态方法、prototype 与 Reflect 对象的两个 hostile 回归仍分别完成 Core foreign throw
  normalization 及 Web sync/async error report，污染读取为 0；永久 boundary guard 禁止
  direct `Error.isError`、live Promise then 与 handler Set 操作回流。B-RUNTIME-ERROR 的
  H+L+R 证据因此与实现一致，不新增重复的公开 API 或账本类别。
- Lite 对最新只读数据视图做真实消费时又暴露出两个相邻问题。第一，组件的只读 Map prop
  返回 `readonly Message?`，纯读取 helper `messagePreview` 却错误声明为可变 `Message?`；Lite
  已把这个公开函数收紧为 `readonly Message?`，没有在语言里加入隐式可变降级。Workbench
  安装验收也同步要求 `route.params` 只暴露 `size/get/keys`、不暴露 `set`，hover 明确显示
  `readonly Map<string, string>`。第二，嵌套 JSX token 被平移到文件坐标时，其结构化 payload
  仍保留片段局部坐标，导致真实错误落在 `latestBySession.get(session.id)` 却显示到早先的
  `colors.rule`。Web parser 现在递归平移嵌套 JSX/Look payload 的 element、attribute、child、
  expression 与 line spans；最小 semantic/diagnostic 回归和对 Lite 旧签名的项目级注入都证明
  位置精确回到原表达式。
  当前组合证据为 `npm run check`（98 个文档示例、45 项 runtime boundary）、492/492
  compiler/runtime、四示例 check/Vel tests、完整开发/生产/外部预览与 27+6+15+6
  Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，以及独立 Lite
  四项目 check、32+28 tests、package acceptance、51/51 三浏览器 Desktop 场景与生产构建
  全部 exit 0。并行的函数返回推断/只读所有权改版也已进入同一工作树，因此不能把相对
  W-71 的全部体积变化归因于错误 ABI；最终组合薄包为 837,359 bytes（817.7 KiB），host
  235,904、renderer 569,522、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `9e0fd891b433ad0bcd585534792c75c84a85449e0d236664ccc1572e9888339a`。
  VelarOS Desktop 产品工作树保持为空；本轮未提交、未推送、未发布。
- Core 标准模块的相邻宿主审计继续关闭了 `velar/id` 与 `velar/log` 的 live-global
  缺口。ID 现在于模块初始化时捕获 crypto 对象、data-valued `randomUUID`、RegExp test、
  Reflect apply 与 Error 身份；日志则捕获 clock、数值/字符串 intrinsic、Map/Set 构造与
  prototype/iterator 操作、Promise rejection observation、record freeze/build 和 fallback
  console target/writers。初始化后替换 global capability、原对象方法、prototype 或静态函数
  都不能再重定向行为；`useSink`/`setLevel` 仍是唯一显式定制点。两项永久 boundary guard
  将 ledger 增至 47 条，hostile 回归同时保留 cross-realm Map、sink snapshot、非 Promise
  结果与非 Error failure 的既有语义。
- 完整浏览器矩阵随后暴露了并行 readonly 改版的真实契约冲突。该轮曾实验过类成员只读
  契约；后续语言收敛已将它移除：readonly 只描述深层数据视图，class、方法和 getter 均不
  承担该职责，调用后的窄化事实改由使用处运行时复核。`api-dashboard` 已回到普通
  `ChartScale` 方法并保留真实 SVG 三引擎场景。该轮当时的组合证据为
  `npm run check`（99 个文档示例、47 项 runtime boundary）、498/498 串行测试、四示例
  check/Vel tests、完整 dev/production/external-preview 与 27+6+15+6 三浏览器矩阵、六包安装
  消费/release rehearsal、Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package
  acceptance、51/51 Desktop 三浏览器场景与生产构建。Lite 薄包为 837,837 bytes（818.2
  KiB），host 235,904、renderer 570,000、capability host 30,540、metadata 1,393，外置
  Node.js >=24，SHA-256 为
  `adfe74360d858f52037ea9887f4d72fcd89134bd51d3ab622f0e3c424e7c095f`。未提交、未推送、
  未发布，VelarOS Desktop 产品源码仍未修改。
- Core 标准库继续按同类宿主所有权清理，关闭了 `velar/math` 与 `velar/time` 在普通调用中
  重读 live global/prototype 的缺口。Math 现在于模块初始化时捕获数值常量、全部 Math/Number
  data operation、随机源、Reflect apply 与错误构造；随机性仍来自宿主 `Math.random`，但后续
  替换 Math/Number 不再重定向已初始化模块。Time 同样一次捕获 wall/monotonic clock、Date
  构造与 prototype 操作、Intl formatter 构造/format/formatToParts、数值/字符串/RegExp helper、
  freeze、Reflect 与错误构造，并移除了内部 Map/Set 依赖；当前时间和 locale/time-zone 数据
  仍实时来自宿主。初始化前的无效随机数、时钟和 Intl 结果继续 fail closed，初始化后的全局/
  prototype 污染不再改变语义。两个永久 source guard 将 runtime boundary ledger 增至 49 条。
  当前组合证据为 `npm run check`（99 个文档示例、49 项 runtime boundary）、498/498 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。Lite 薄包为 840,431 bytes（820.7 KiB），host 235,904、renderer 572,594、
  capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `803615f07c1c4e3c4f58a4f0990b2f842267235b065fe022a7b71cfbdb4cb7bc`。本轮未修改
  VelarOS Desktop 产品源码，未提交、未推送、未发布。
- 同一类 Core 宿主审计继续关闭 `velar/url`。模块现在于初始化时捕获 URL/URLSearchParams
  构造和全部 prototype accessor/operation、Map brand/size/entries/set 与 iterator next、组件
  codec、String/Number/Object/Reflect/Error，以及浏览器 location 对象与 href reader。后续替换
  global、prototype 或 Reflect 不再重定向解析、查询和编码；真实 captured Location 的导航值
  仍会更新。`withQuery` 也不再把 correctness 交给 URL 内部重新发现
  `URLSearchParams.prototype.toString`，而是先在独立参数对象完成受控序列化再一次写回 search。
  跨 realm Map、严格字符串、2 MiB/100000-field 上限与不触发 coercion hook 的契约保持不变；
  pre-init hostile URL 结果和 post-init 全面污染均有执行回归，永久 guard 将 ledger 增至 50 条。
  当前组合证据为 `npm run check`（99 个文档示例、50 项 runtime boundary）、498/498 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。Lite 薄包为 842,616 bytes（822.9 KiB），host
  235,904、renderer 574,779、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `dfcb58e32e636f28e948289b068c8210fc4713baf8deb6ada13feea91fa4f890`。
  VelarOS Desktop 产品源码未修改；未提交、未推送、未发布。
- 剩余 Core 标准模块盘点后先关闭 `velar/collections` 的 live host 缺口。输入原本虽会复制成
  checked List，28 个 helper 随后仍调用 live Array methods、Map/Set prototype、Number/Math/
  Object 和错误构造，因此只能防实例 override，不能防初始化后的全局污染。现在模块初始化时
  捕获 Array/Map/Set 构造与所需操作、稳定 sort/join、SameValue 身份、数值 predicates/bounds、
  freeze、Reflect 和 Error；遍历、筛选、窗口、flatten、聚合和 grouping 全部使用显式索引循环
  处理同一 checked snapshot。稳定排序、SameValueZero 唯一性、回调布尔边界、1000000-item 与
  16 MiB 上限保持不变。完整 hostile execution 替换构造器、prototype、Number/Math/Object、
  Reflect 与 Error 后覆盖全部 helper 类别，poison 调用为 0；永久 guard 将 ledger 增至 51 条。
  当前组合证据为 `npm run check`（99 个文档示例、51 项 runtime boundary）、499/499 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。Lite 薄包为 843,454 bytes（823.7 KiB），host
  235,904、renderer 575,617、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `af1f39c4e911975b7534eab14ceb491ba18f2d9032b50680b3c24e195fcec3d8`。
  VelarOS Desktop 产品源码未修改；未提交、未推送、未发布。
- 严格 JSON 与运行时 Type 身份继续按 compiler-owned ABI 收口。原先 `velar/json` 虽捕获
  `JSON.parse/stringify`，验证、快照、稳定序列化与深比较仍会在普通调用中重读 Array/Map/Set/
  WeakSet/Object/Number/String/RegExp/Reflect 与错误构造；Type 注册表也仍通过 live WeakSet
  prototype 完成注册和校验。compiler 的 strict JSON runtime 与共享 Type registry 现在于初始化
  时捕获全部必需 intrinsic，`velar/json`、HTTP/storage 等消费者继承同一严格序列化实现；
  `deepEqual` 使用捕获的图遍历、Map/Set iterator 和 record descriptor ABI，`stableStringify` 使用
  捕获的稳定排序与对象构造操作。显式 runtime Type registry 仍是唯一动态身份 seam，但宿主
  descriptor、Symbol、WeakSet 和错误身份不再可被初始化后的污染重定向。两组 hostile execution
  在全面替换全局构造器、prototype、Reflect、JSON 与错误构造后覆盖 parse/stringify/clone/
  isSerializable/deepEqual、后续 Type 注册和伪造 Type 拒绝，poison 调用均为 0；永久 guard 将
  runtime boundary ledger 增至 52 条。
  当前组合证据为 `npm run check`（99 个文档示例、52 项 runtime boundary）、503/503 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。503 项中包含并行函数返回值推断改版已进入工作树的新增回归，不能全部归因于
  W-79。Lite 薄包为 851,868 bytes（831.9 KiB），host 235,904、renderer 584,031、
  capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `a7b5e036a9921861904aa08037f53d658622537e9ed9c1620a5ce162a409b0d4`。VelarOS Desktop
  产品源码未修改；未提交、未推送、未发布。
- Core 标准模块相邻审计继续关闭 `velar/test`。`deepEqual` 在 W-79 后已使用捕获图 ABI，
  但 matcher 的失败显示、文本包含/正则、长度校验、真实 Promise rejection 检查与错误构造仍
  在普通调用时重读 Array/String/WeakSet/Object/Number/Math/Promise/JSON/RegExp/Reflect。
  模块现在初始化一次捕获这些操作；List/Map/Set/record 的诊断遍历使用同一 captured graph/
  descriptor/iterator ABI，Promise `then` 仅作为真实 Promise brand check，任意 thenable 仍不读取
  getter。失败显示明确限制为 1000 nodes、16 层、每集合 50 项、字符串 256 code units，严格
  bool、dense List、同步 `toThrow` 与异步 `toReject` 的现有 API/语义不变。完整 hostile execution
  替换所有相关全局、prototype、Reflect 与错误构造后覆盖全部 matcher 和复合失败诊断，poison
  调用为 0；永久 guard 新增 B-CORE-TEST-HOST，将 runtime boundary ledger 增至 53 条。
  当前组合证据为 `npm run check`（99 个文档示例、53 项 runtime boundary）、507/507 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。507 项中包含并行函数返回值推断改版进入同一工作树的新增回归，不能全部归因于
  W-80。Lite 生产包不携带测试模块，因此薄包保持 851,868 bytes（831.9 KiB），host
  235,904、renderer 584,031、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `a7b5e036a9921861904aa08037f53d658622537e9ed9c1620a5ce162a409b0d4`。
  VelarOS Desktop 产品源码未修改；未提交、未推送、未发布。
- Core 文本链路整体收口为 compiler-owned 初始化 ABI。底层 String helper 原本只保存若干
  prototype function，却仍通过 live `.call`、Array.from、Number/Math、字符串 iterator 和错误
  构造执行；`velar/text` 层的 pattern options、RegExp、title/slug/lines/words、indent/dedent、
  HTML escape 与 pattern output 同样重读 live Object/Array/String/RegExp。compiler text runtime
  现在捕获 Array/String/Number/Math/Object/Reflect/Error 及所需原型操作，并用显式 code-unit
  offset 完成 Unicode 迭代。`velar/text` 在此基础上捕获 RegExp 构造与 `exec`、descriptor、
  freeze/join/normalize 等操作；pattern replace/split 由 captured `exec` 显式推进，不调用仍会
  动态发现 `exec` 的 RegExp Symbol hook。全部 18 个公开 helper 与核心 String method 在全面
  替换构造器、prototype、iterator、Reflect 和 Error 后保持 Unicode 位置、字面 replacement、
  dense result 与错误身份，poison 调用为 0。永久 guard 新增 B-CORE-TEXT-HOST，将 runtime
  boundary ledger 增至 54 条。
  当前组合证据为 `npm run check`（99 个文档示例、54 项 runtime boundary）、508/508 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。508 项仍包含并行函数返回值推断改版的组合回归；W-81 自身新增一项全面 hostile
  execution。更完整的 text ABI 使 Lite renderer 增加 2,344 bytes，当前薄包为 854,212 bytes
  （834.2 KiB），host 235,904、renderer 586,375、capability host 30,540、metadata 1,393，
  外置 Node.js >=24，SHA-256 为
  `c164da6d0ff7ff6c015bf464c0a401c9c3448b6e6c327fc295f734aa945b3841`。VelarOS Desktop
  产品源码未修改；未提交、未推送、未发布。
- Core Number receiver method 从 emitter 内联实现收口为独立 compiler-owned 初始化 ABI。
  原先 `.abs()`、`.round()`、`.floor()`、`.ceil()` 与 `.toFixed(digits)` 会在每次调用时重读
  live Math/Number/Object、`Number.prototype.toFixed`、Reflect 与错误构造；现在
  `number-runtime.ts` 初始化一次捕获所需 descriptor、Math operation、`Number.isSafeInteger`、
  native `toFixed`、Reflect apply 及 TypeError/RangeError 身份，emitter 只选择并注入这一唯一
  source fragment，extension seam 同步导出。完整 hostile execution 在初始化后替换全部相关
  operation 和全局构造器，五个公开 receiver method、动态 receiver 拒绝、digits 范围拒绝与
  原始错误身份均保持，poison 调用为 0。永久 guard 新增 B-CORE-NUMBER-HOST，将 runtime
  boundary ledger 增至 55 条；collection emitter helper 是下一类独立 ABI，不与本波混合。
  当前组合证据为 `npm run check`（99 个文档示例、55 项 runtime boundary）、509/509 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。509 项和当前产物同时包含已完成 Look 改版及并行函数返回值推断基线，不能全部
  归因于 W-82。Lite 当前组合薄包为 857,983 bytes（837.9 KiB），host 235,904、renderer
  590,146、capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `7aff5a322a6e82ae177eabc1c7357aa69472b1db7783bd0232c88209b734be7f`。VelarOS Desktop
  产品工作树保持干净；未提交、未推送、未发布。
- Collection identity 与 runtime Type traversal 从 emitter 巨型 helper 块中拆为独立的
  compiler-owned 初始化 ABI。普通集合代码只注入轻量 identity fragment，捕获 Array/Map/Set/
  Object/Reflect、brand/size descriptor 与 TypeError；只有动态 runtime Type 检查才额外注入
  traversal fragment，捕获 own-key operations、Map/Set iterator 与原生 `next`。List、Set、Map、
  Record 的动态类型检查不再通过 `for...of`、数组 iterator 或可变 prototype 重新发现宿主操作，
  Record traversal 也改为显式索引循环。完整 hostile execution 在初始化后替换相关全局构造器、
  descriptor/key operations、Map/Set iterator/size/entries/values 与 Reflect 后覆盖四类 runtime
  Type，poison 调用为 0；永久 guard 新增 B-RUNTIME-COLLECTION-IDENTITY，将 runtime boundary
  ledger 增至 56 条。最初的合并 fragment 会让所有集合用户携带完整 Type traversal，已按实际
  Lite 产物反馈拆层；普通 collection mutation/transform helper 仍有独立 live-host 审计，列为
  W-84，不能视为本波已经完成。
  当前组合证据为 `npm run check`（99 个文档示例、56 项 runtime boundary）、511/511 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。511 项和当前产物包含已经完成的函数返回值自动推断改版，不能全部归因于 W-83。
  Lite 当前组合薄包为 869,241 bytes（848.9 KiB），host 235,904、renderer 601,404、
  capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `ccffffcb5b0ad0396269cc1d5ddd3cba3b6e925b71aad311a0f687307b4dd6c9`。VelarOS Desktop
  产品工作树保持干净；未提交、未推送、未发布。
- List 普通操作层继续从 emitter 的 ambient host 读取收口为独立 compiler-owned 初始化 ABI。
  `collection-runtime.ts` 新增按需注入的 List fragment，捕获 Array/Object/Number/Math/Reflect、
  dense descriptor operations、integer/NaN/finite/bounds、native join/sort/reverse 与错误身份；
  构造（含 async/spread）、索引读写、迭代、slice、snapshot、全部 receiver transform/aggregate/
  mutation 和 clear 使用显式索引循环或捕获操作。完整 hostile execution 在初始化后替换相关
  全局、prototype、Symbol registry lookup、Reflect 与错误构造，覆盖构造、索引、迭代和全部
  List receiver，poison 调用为 0，原始 TypeError/RangeError/IndexError 身份保持。全量回归还
  找到官方 `velar/collections` 已有私有 helper 与初版新 fragment 同名；内部 ABI 已改用更窄的
  `__velarCollectionList*` 前缀，安装组合不再发生顶层冲突。永久 guard 新增
  B-RUNTIME-LIST-HOST，将 runtime boundary ledger 增至 57 条。Set/Map 与 Record operation
  host 仍保留为后续独立波次，不能归入 W-84。
  当前组合证据为 `npm run check`（99 个文档示例、57 项 runtime boundary）、512/512 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。Lite 当前组合薄包为 873,706 bytes（853.2 KiB），host 235,904、renderer
  605,869、capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `1466dcf68893c34316b3ed348539313f125b4084f311202a3eadad0cfab92633`；相对 W-83 增加
  4,465 bytes。VelarOS Desktop 产品工作树保持干净；未提交、未推送、未发布。
- Set/Map 普通操作层收口为独立 compiler-owned 初始化 ABI。新 fragment 捕获 Map/Set
  constructor、native size accessor、全部必需 get/set/add/has/delete/clear、keys/values/entries、
  iterator factory 与原生 `next`、record-to-Map prototype reflection、freeze、Reflect 和
  RangeError identity。构造、单槽/双槽 iteration、size/get/has、copy/update/remove/clear 以及
  keys/values/entries snapshot 全部改用捕获操作和显式 iterator step，不再执行 live prototype、
  `for...of` host iterator、spread 或 iterable constructor。完整 hostile execution 在初始化后
  替换 Map/Set/Array/Object/Reflect 全局、全部相关 prototype、size getter、Map/Set iterator
  `next` 与错误构造，覆盖 List/Set/record/Map construction、全部 receiver、单槽/双槽 iteration、
  frozen entries 和原始 TypeError/RangeError identity，poison 调用为 0。永久 guard 新增
  B-RUNTIME-SET-MAP-HOST，将 runtime boundary ledger 增至 58 条。Record operation host
  仍保留为 W-86，不归入本波。
  当前组合证据为 `npm run check`（99 个文档示例、58 项 runtime boundary）、513/513 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。Lite 当前组合薄包为 881,830 bytes（861.2 KiB），host 235,904、renderer
  613,993、capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `896046e18c9d04b07136b6cd691ab58656ca9f0e817e983a557a37f015f24d7a`；相对 W-84 增加
  8,124 bytes。VelarOS Desktop 产品工作树保持干净；未提交、未推送、未发布。
- Record 普通操作层从 List-named reflection 与 ambient Array/Object/Reflect 中独立为
  compiler-owned 初始化 ABI。新 fragment 捕获 own names/symbols/descriptors、define、identity、
  delete、freeze、Reflect 与错误身份；validation、bracket read/write、单槽/双槽 iteration、
  get/set/has/remove/clear/copy/keys/values/entries 全部使用显式 field-index loop 和捕获操作。
  完整 hostile execution 在初始化后替换 Array/Object/Reflect 全局及全部相关 operation，覆盖
  indexing、iteration、全部 Record receiver、frozen entry 与原始 TypeError/RangeError identity，
  poison 调用为 0。永久 guard 新增 B-RUNTIME-RECORD-HOST，将 ledger 增至 59 条；record
  literal/spread 仍由 B-LOWER-RECORDS 独立负责。
  当前组合证据为 `npm run check`（99 个文档示例、59 项 runtime boundary）、514/514 串行
  compiler/runtime、四示例、完整 dev/production/external-preview 与 27+6+15+6 三浏览器、
  六包安装/rehearsal、Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package
  acceptance、51/51 Desktop 三浏览器与生产构建。Lite 薄包为 886,715 bytes（865.9 KiB），
  host 235,904、renderer 618,878、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `3b6786cce2972f30838b04e0c1e5f034a909a2a1b36a7a8208fd9788cba4551a`；相对 W-85
  增加 4,885 bytes。VelarOS Desktop 产品工作树保持干净；未提交、未推送、未发布。
- W-87 继续审计 B-LOWER-RECORDS/B-LOWER-BINDINGS，确认 Record literal/spread、对象绑定
  与 List binding rest 虽已有 compiler helper，仍重新读取 ambient Array/Object/Reflect、
  `hasOwnProperty.call`、Array iterator/`push` 和 Error constructors。现三个 lowering 路径
  全部复用初始化期捕获的 Record/List ABI：同步/异步 Record parts、spread source fields、
  object rest 与 List rest 均显式按索引遍历，descriptor/define/allocation/List rejection 与
  TypeError/RangeError identity 不再受应用代码替换影响。完整 hostile execution 在模块初始化
  后替换全局与原生 Array/Object/Reflect 操作、Array iterator/`push`、`hasOwnProperty` 和
  错误构造器，覆盖同步/异步构造、`__proto__`、replacement order、object/List binding、
  rest、shape failure、field budget 与原始错误身份，poison 调用为 0。永久 guard 升级既有
  B-LOWER-RECORDS 与 B-LOWER-BINDINGS；没有制造重复边界，因此 ledger 仍为 59 条。
  structural `match` pattern lowering 仍是下一独立边界，不计入本波。
  当前组合证据为 `npm run check`（99 个文档示例、59 项 runtime boundary）、515/515 串行
  compiler/runtime、四示例、完整 dev/production/external-preview 与 27+6+15+6 三浏览器、
  六包安装/rehearsal、Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package
  acceptance、51/51 Desktop 三浏览器与生产构建。Lite 薄包保持 886,715 bytes（865.9 KiB），
  host 235,904、renderer 618,878、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 仍为 `3b6786cce2972f30838b04e0c1e5f034a909a2a1b36a7a8208fd9788cba4551a`；本波无产品补丁、
  无体积变化。VelarOS Desktop 产品工作树保持干净；未提交、未推送、未发布。
- W-88 收口 structural `match` 的独立 lowering boundary。旧 MatchList/MatchObject 生成代码
  会重新读取 ambient Array/Object reflection、执行 Array iterator 与 live `defineProperty`；
  object rest 也没有独立 field-count 上界。现 List length/element descriptor、Record field/rest、
  allocation 与 definition 全部复用初始化期捕获的集合 ABI，snapshot 和 rest 均显式按索引
  遍历，并统一受 1,000,000 item/field 上界约束。语言语义保持不变：sparse/extended List、
  accessor field、symbol rest、超预算 shape 与普通不匹配都只让当前 case miss，不会读取 getter
  或把动态形状异常冒充程序错误。完整 hostile execution 在初始化后替换全局与原生
  Array/Object/Reflect、Array iterator/`push` 及全部相关反射操作，覆盖嵌套正常匹配、List/
  object rest、sparse、accessor、symbol、budget 与 else fallthrough，poison 调用为 0。永久
  guard 新增 B-LOWER-MATCH，runtime boundary ledger 增至 60 条。
  当前组合证据为 `npm run check`（99 个文档示例、60 项 runtime boundary）、516/516 串行
  compiler/runtime、四示例、完整 dev/production/external-preview 与 27+6+15+6 三浏览器、
  六包安装/rehearsal、Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package
  acceptance、51/51 Desktop 三浏览器与生产构建。Lite 薄包仍为 886,715 bytes（865.9 KiB），
  host 235,904、renderer 618,878、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 仍为 `3b6786cce2972f30838b04e0c1e5f034a909a2a1b36a7a8208fd9788cba4551a`；本波无产品补丁、
  无体积变化。VelarOS Desktop 产品工作树保持干净；未提交、未推送、未发布。
- W-89 将 compiler-known runtime Type 的验证执行从 ambient JavaScript 收口为独立的
  compiler-owned 初始化 ABI。Type identity 仍由 immutable registry/WeakSet owner 负责；新的
  validation fragment 单独捕获 WeakMap/Set 图状态、own descriptor、Array/Promise/class brand、
  `Function.prototype[Symbol.hasInstance]`、freeze、Reflect 与 ValidationError identity。生成的
  record/alias/enum Type 不再调用 live collection prototype、`instanceof`、`Object.freeze` 或
  ambient error constructor。递归检查保持 1,000 层上界：当前递归栈中的真实 cycle 拒绝，已经
  退出上一分支的共享 DAG 节点接受；字段只读取 own enumerable data descriptor，不执行 getter。
  完整 hostile execution 在初始化后替换全局 Array/Object/Reflect/WeakMap/Set/Promise/Function/
  Symbol/Boolean/TypeError、相关 prototype operation、Promise/class `Symbol.hasInstance` 和 Array
  iterator，仍覆盖正常树、cycle、DAG、accessor、Promise alias、class field、enum、Type freeze 与
  原始错误身份，poison 调用为 0。永久 guard 强化既有 B-RUNTIME-TYPE；identity 与 validation
  没有被重复记账，因此 runtime boundary ledger 仍为 60 条。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、519/519 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。519 项和当前产物同时包含函数返回值推断改版，不能全部归因于 W-89。Lite 当前组合
  薄包为 911,242 bytes（889.9 KiB），host 235,904、renderer 643,405、capability host 30,540、
  metadata 1,393，外置 Node.js >=24，SHA-256 为
  `2556bb3b8de1461c1ca1479ab4b44538efbbc6ed9b6687a2b761ab5b163cea62`；相对 W-88 增加
  24,527 bytes。VelarOS Desktop 产品工作树保持干净；未提交、未推送、未发布。
- W-90 升级既有 B-HOST-CLASS，将 public/private/own-static/inherited-static 的 checked field
  read 从 emitter 内联 ambient helper 收口为独立 compiler-owned 初始化 ABI。旧 helper 在每次
  读取时重新发现 live `Reflect.get`、`Object.getPrototypeOf`、own descriptor 与 TypeError；现
  `class-runtime.ts` 捕获 Object/Reflect/Error、`Reflect.apply/get` 和 prototype/descriptor
  operations，emitter 只在存在受检查字段读取时按需注入。完整 hostile execution 在生成模块
  初始化后替换全局 Object/Reflect/TypeError 及原生 `getOwnPropertyDescriptor`、`getPrototypeOf`、
  `Reflect.apply/get`，正常 public/private/own/inherited static read 与未初始化字段的原始
  TypeError identity 均保持，poison 调用为 0。永久 guard 强化 B-HOST-CLASS；没有制造重复分类，
  runtime boundary ledger 仍为 60 条。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、520/520 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。Lite 当前组合薄包为 913,208 bytes（891.8 KiB），host 235,904、renderer
  645,371、capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `432545b9bc0b3e4b1ba73570d881ba9508f27fadc86a803296fb1b67da5321f7`；相对 W-89 增加
  1,966 bytes。VelarOS Desktop 产品工作树保持干净；未提交、未推送、未发布。
- W-91 升级既有 B-RUNTIME-REGISTRY 与 B-WEB-REACTIVITY，将 JavaScript 参数 raw identity
  和普通集合响应式操作从每次调用重新读取 ambient `globalThis`/`Symbol.for`/Object
  descriptor/runtime fields，收口为 compiler-owned 初始化 ABI。Core-shaped 模块捕获 global、
  Object、Symbol、TypeError 与 immutable data operations；provider 真正缺席时不缓存，允许
  ESM dependency 在 Web owner 稍后安装 registry 后重新收敛，首次合法 provider 则缓存。
  accessor/mutable/replaceable/extensible/symbol-bearing 或版本不兼容的 registry fail closed，
  不执行 getter。registry operations 现被明确锁定为 receiver-independent compiler callables，
  因此调用捕获的函数身份不需要再保留 ambient Reflect 路径。Web module 自己已经安装并完整
  验证 runtime 时走更小的 local adapter；raw-only 与 collection extension 仍按需拆层，避免
  JavaScript-only 模块携带集合桥接。
  hostile execution 在模块初始化后替换 globalThis 本身、Object/Reflect/Symbol/TypeError、
  own descriptor/prototype/extensibility/symbol discovery、Reflect.apply 与 Symbol.for，raw proxy
  conversion 和 collection append/size 仍正确且 poison 调用为 0；另有 absent-then-present
  provider、首次合法缓存和 accessor field 零读取拒绝证据。永久 guard 强化原有两条边界，
  ledger 仍为 60 条。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、523/523 串行
  compiler/runtime、四示例 check/Vel tests、完整 dev/production/external-preview 与
  27+6+15+6 Chromium/Firefox/WebKit、六包安装消费/release rehearsal、Workbench 安装态，
  以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop 三浏览器场景与
  生产构建。Lite 当前组合薄包为 925,301 bytes（903.6 KiB），host 235,904、renderer
  657,464、capability host 30,540、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `c039412aa931d127967bb47327d0e40ab9e1985cf179df0030f6853ec8c0c964`；相对 W-90 增加
  12,093 bytes。首版完整 verifier 重复曾达到 934,506 bytes，Web-local adapter 与直接捕获
  callable 将其削减 9,205 bytes。剩余增量来自 bundle 中 10 个 Core-shaped module 各自携带
  general late-binding verifier；下一波应审计 project-level compiler runtime helper hoist，
  不得通过放松 fail-closed 校验换体积。VelarOS Desktop 产品工作树保持干净；Workbench
  只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-92 将 W-91 的 general reactive bridge 从逐模块重复注入收口为 compiler-owned project
  runtime module。直接 `compile()` 仍默认内联并保持完全自包含；项目编译通过
  `CompileResult.runtimeModules` 声明所需内部 ESM，dev/test/run/Node build/Web production
  adapters 只负责 serve/write/bundle compiler 提供的精确 source。内部模块有 source、稳定
  specifier 和八个最小 export，但没有 `ModuleInterface`，因此不会出现在 Standard API，也不
  会成为用户可依赖的语言包。Web 自有模块继续使用 W-91 的 compact local adapter；只有
  Core-shaped consumers 共享 general late-binding verifier，fail-closed registry 语义未放松。
  首次浏览器门禁暴露了一个真实 CLI 路由缺陷：版本化内部名含数字 `v1`，而 dev standard
  module asset matcher 只接受字母与连字符，浏览器因而取得 HTML 而非 JavaScript。路由现
  接受数字，永久测试同时证明 standalone inline、两个项目模块共享、内部 source 可执行、
  public API 不可见以及 dev asset URL 可解析。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、524/524 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 905,253 bytes（884.0 KiB），
  host 235,904、renderer 637,416、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `3209cdd3ff5af2c3d120cf9c8789205da798271ee7e78a570e32c346f6bde7bf`；
  相对 W-91 减少 20,048 bytes，也比 W-90 少 7,955 bytes。VelarOS Desktop 产品工作树保持
  干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-93 将 compiler-lowered String/Number receiver method runtime 从 11 个 Core-shaped module
  的逐模块重复注入收口为第二个 compiler-owned project runtime module。文本与数字 fragment
  仍各自拥有唯一实现和完整初始化期 host capture；直接 `compile()` 继续内联二者并完全
  自包含，项目编译只导入 22 个内部 lowering entry points。内部 primitive module 有版本化
  specifier/source，但没有 `ModuleInterface`，不会与公开 `velar/text` 混淆，也不会成为用户
  依赖。永久测试覆盖 standalone inline、两个项目 consumer、精确 export、真实 String/Number
  执行、dev asset route 和 Standard API 不可见；guard 同时锁定 compiler source、emitter
  requirement 与 CLI materialization。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、525/525 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 886,233 bytes（865.5 KiB），
  host 235,904、renderer 618,396、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `57dcad62b1de9817f10e0e55312ae7569fd7bd1be2237e60a2aa241e58247152`；
  相对 W-92 减少 19,020 bytes，相对 W-91 累计减少 39,068 bytes。产物审计仍发现 checked
  class-field runtime 8 份、runtime Type validation 14 份、error normalization 13 份；下一波
  必须先区分可共享的无状态 host ABI 与必须保留的 module-local identity/state，再按类别收口。
  VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5
  文件变化；未提交、未推送、未发布。

- W-94 将 checked public/private/own-static/inherited-static field read 的 compiler-owned host
  ABI 从 8 个模块的重复内联收口为 project-shared internal module。runtime 只含初始化期
  Object/Reflect/TypeError capture 与三个无状态 checked read operations，没有 module-local
  identity/state；因此直接 `compile()` 继续内联，项目编译安全共享。内部模块没有
  `ModuleInterface`，不引入 class reflection API。永久测试覆盖 standalone、两个 project
  consumer、精确 namespace、dev route/public API 隔离，以及共享模块初始化后全面替换
  Object/Reflect/TypeError、descriptor/prototype/apply/get 时的 public/private/inherited/own
  static 正常读取和原始 TypeError identity，poison 调用为 0。产物复查确认
  `__velarClassNativeObject` 从 8 份降为 0 份内联，只保留一个内部模块 owner。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、526/526 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 883,695 bytes（863.0 KiB），
  host 235,904、renderer 615,858、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `59c4b351587ed0a29a160ac5b9a8ae6af1785d9f174f89ed7d02c53d5409cd2d`；
  相对 W-93 减少 2,538 bytes，相对 W-91 累计减少 41,606 bytes。下一波是 error
  normalization ownership：当前 13 份重复同时来自 Core catch lowering 与 Web error foundation，
  必须把纯 normalization ABI 从 Web 的 module-local scheduling/report state 中拆出后共享，
  不能只改 base emitter。VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数
  返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-95 将 Core `catch` lowering 与 Web error foundation 中重复的纯 error normalization
  runtime 收口为 project-shared compiler-internal module。拆分严格保留所有权边界：
  `errorApply`、`isError`、`normalizeError` 是无状态语言 ABI，可以由项目模块共享；Web 的
  report/scheduling/handler state 仍由各 Web module 自己拥有，没有被提升成项目全局状态。
  直接 `compile()` 和 standalone Web compilation 继续内联完整 runtime，项目编译才记录内部
  requirement 并导入精确三个 operation；内部模块没有 `ModuleInterface`，不会成为用户可依赖
  的错误 API。实现审计同时发现旧 error runtime 在失败路径仍读取 live `TypeError`，并通过
  ambient Object/Reflect 找 descriptor/apply；现已在模块初始化期捕获 Object、Reflect、
  TypeError、getOwnPropertyDescriptor、Reflect.apply 与 Error.isError。永久 hostile execution
  在初始化后替换 Error/String/Object/Reflect/TypeError 及其相关操作，仍保持原始 Error/TypeError
  identity 和行为，poison 调用为 0。永久测试覆盖 standalone Core/Web、两个 Core project
  consumer、shared Web composition、精确 exports、dev asset route 与 Standard API 不可见；
  boundary guard 锁定 compiler source、Core/Web emitter requirements、CLI materialization 和
  Web stateful body 隔离。生产检查确认 `__velarErrorNativeError` 从 13 份重复内联降为 0。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、527/527 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 876,545 bytes（856.0 KiB），
  host 235,904、renderer 608,708、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `324ef7164f9ab9f609a5cc5e40b4afe9ac151ca39b608122319d018e264d2569`；
  相对 W-94 减少 7,150 bytes，相对 W-91 累计减少 48,756 bytes。下一波必须先审计仍有
  14 份的 runtime Type validation：它依赖 module-local collection ABI 和类型图身份，不能把
  整段机械提升为共享模块。VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数
  返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-96 将 runtime `Type.is`/`Type.parse` 的 host ABI 从 14 个 generated module 的重复内联
  收口为 project-shared compiler-internal module。所有权审计没有把 Type 身份或递归 predicate
  全局化：具体 record/alias/enum Type 对象、类型名和 generated check function 仍属于声明模块；
  共享模块只拥有初始化期 WeakMap/Set/WeakSet、Array/Map/Set/Promise/class brand、descriptor、
  iterator、freeze/Reflect/Error 操作，以及每次 validation call 都新建的 graph-state factory。
  standalone `compile()` 继续组合完整 inline runtime，项目模块导入 20 个内部 operation；模块
  没有 `ModuleInterface`。永久测试覆盖 standalone、两个 project consumer、精确 exports、dev
  asset route/public API 隔离，并把真实 shared-compiled Tree/Promise/enum/class Type 接到 data-URL
  runtime 后，在初始化后替换 Array/Object/Reflect/WeakMap/Set/Promise/Function/Symbol/Boolean/
  TypeError、WeakMap/Set 原型、Promise/class `Symbol.hasInstance` 和 Array iterator；finite tree、
  cycle、DAG、accessor、Promise/class brand、ValidationError identity 与 frozen Type object 均保持，
  getter reads 和 poison calls 都为 0。生产检查确认 `__velarValidationNativeWeakMap` 的 14 份
  inline owner 降为 0，同时具体 Type declarations 仍留在各自输出模块。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、528/528 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 846,196 bytes（826.4 KiB），
  host 235,904、renderer 578,359、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `1234a87e4bcff90387fcabb11b724d0dd162e86aa4178302e3906fb636ee8136`；
  相对 W-95 减少 30,349 bytes，相对 W-91 累计减少 79,105 bytes。下一波审计 Promise/async
  normalization 的 9 份重复；它的 immutable global WeakMap registry 与 thenable 检查属于
  compiler lowering，不得和 Web scheduling state 混合。VelarOS Desktop 产品工作树保持干净；
  Workbench 仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-97 将 Promise normalization 与 async resolved-value guard 从 9 个 generated module 的重复
  内联收口为 project-shared compiler-internal module，并把全局 cache identity 的
  `velar.promise.normalization.v1` literal 提升到 `runtime-abi.ts` 单一所有者。共享边界只包含
  `normalizePromiseValue` 与 `asyncResolvedValue`：实际 Promise、rejection、undefined-to-null
  语义和 immutable global WeakMap cache 在项目内统一；async-for 的 source/own-data `next`
  receiver capture 继续属于发起 pull 的 module，没有被错误提升成全局状态。standalone
  `compile()` 仍内联完整 runtime；项目 emitter 按真实 lowering hints 只导入所需 operation，
  内部模块无 `ModuleInterface`。同时把旧 runtime 的 ambient `Reflect.apply`、Object methods、
  WeakMap/Promise prototype 和 `Symbol.for` 直接读取收紧为初始化期 Object/Reflect/WeakMap/
  Promise/Symbol/TypeError descriptor capture。永久测试覆盖 standalone、两个 project consumer、
  精确 exports、dev route/public API 隔离和 shared compiled module execution；初始化后替换
  Object/Reflect/WeakMap/Promise/Symbol/TypeError 及其 descriptor/prototype operations，仍保持
  normalization identity、undefined-to-null、rejection、async return、getter-free thenable rejection
  与原始 TypeError identity，getter reads/poison calls 为 0。全量门禁首次运行暴露一条旧测试仍
  要求 consumer 内联 registry literal；断言已按新契约改为 hidden import + runtime requirement +
  consumer literal absence，随后全绿。生产检查确认旧 normalization runtime 的 9 份 consumer
  owner 降为 0，只保留一个内部模块 owner。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、529/529 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 835,487 bytes（815.9 KiB），
  host 235,904、renderer 567,650、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `79e4f69347cda4944e5463b4967bb473041c0153e40ebdde67ad35c103c967ec`；
  相对 W-96 减少 10,709 bytes，相对 W-91 累计减少 89,814 bytes。下一波审计仍在 12 个
  Core-shaped consumer 中重复的 collection identity/host ABI；必须按 brand/traversal 与普通
  mutation helper 的依赖闭包分层，不能共享 application collection state。VelarOS Desktop
  产品工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、
  未推送、未发布。

- W-98 将普通 List/Set/Map/Record lowering 的 collection host ABI 从 12 个 Core-shaped
  consumer 的重复内联收口为 project-shared compiler-internal module。边界按审计结论只提升
  realm/host operations：Array/Map/Set constructors 与 brands、Object/Reflect descriptors、
  Number/Math、size getters、iterator factories/next、join/sort/reverse、Map/Set mutation 和
  Record define/delete/freeze 共 53 个精确 operation；`__velarListAppend`、`__velarMapSet`、
  `__velarRecordSet` 等具体 lowering algorithm、reactive links、callbacks 和 application
  collection values 仍属于 consumer module。standalone `compile()` 保持四段 canonical host
  runtime 内联；project emitter 导入 shared host，同时继续按源模块生成算法，因此没有形成
  project-global collection store 或公开 reflection API。内部模块无 `ModuleInterface`，53 个
  export 名由一个 canonical list 同时驱动 source 与 imports，避免两端 ABI 漂移。永久测试覆盖
  standalone、两个 project consumer、精确 exports、dev route/public API 隔离，并把真实
  shared-compiled List/Set/Map/Record 操作连接到 data-URL collection/reactive runtimes；初始化后
  全面替换 Array/Map/Set/Object/Number/Math/Reflect/Symbol/TypeError/RangeError、descriptor、
  size、iterator 与 mutation operations，四类 collection 仍正确且 poison calls 为 0。既有三组
  standalone 全面 hostile tests 继续覆盖完整 receiver surface。生产检查确认
  `const __velarCollectionNativeArray = globalThis.Array` 的 12 个 consumer owner 降为 0，模块
  局部 collection algorithms 仍在。
  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、530/530 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 801,718 bytes（782.9 KiB），
  host 235,904、renderer 533,881、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `4ef4cbd1fc0197293ad9ca0a1ce7982c6df57b3d8ee6abd13c7235ae08c5cd6b`；
  相对 W-97 减少 33,769 bytes，相对 W-91 累计减少 123,583 bytes。下一波重新扫描剩余
  generated-runtime owner，不按旧清单猜测；继续以重复数量、状态所有权和 Lite 真实产物收益
  共同排序。VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数返回值推断相关
  的既有 5 文件变化；未提交、未推送、未发布。

- W-99 将 57 个普通 List/Set/Map/Record lowering algorithm 从每个 Core-shaped
  consumer 的重复内联收口为 project-shared compiler-internal module。审计确认这些算法
  只接收 application collection、callback、key/value 和 generated operands 作为参数，
  不拥有 application collection store 或 reactive graph；因此 project compilation 现在
  导入一个 stateless lowering module，而 standalone `compile()` 仍从同一 canonical source
  内联 host + reactive bridge + algorithms，避免形成第二份实现。lowering module 通过新增的
  compiler-extension `modules.dependencies` 明确依赖 collection host 与 reactive bridge；CLI
  为 unbundled target 递归物化同一 source owner 的 dependency closure，高优先级 source
  replacement 不会继承被替换实现的隐藏依赖，unknown edge fail closed，所有内部模块仍无
  `ModuleInterface`。永久测试覆盖 exact 57 exports、dependency closure/override/unknown edge、
  standalone/shared 双模式、双 consumer、dev route/public API 隔离，以及连接 data-URL
  lowering/host/reactive 三模块的真实 hostile execution；初始化后全面替换
  Array/Map/Set/Object/Number/Math/Reflect/Symbol/TypeError/RangeError、descriptor、iterator 与
  mutation operations，List/Set/Map/Record 结果仍正确且 poison calls 为 0。

  Lite 重建又暴露并推动修复了一个 CLI 产物正确性缺陷：普通 `velar build` 过去只覆盖
  当前文件，会把已经离开项目图的 source/package/runtime module 留在 `dist`；因此 Lite 的
  `cli/dist` 仍残留已经删除的 `@velarscript/agent` 幽灵包。directory build 现在先写完整 sibling
  staging，再以可恢复的 previous-output swap 替换 owned output；删除 source dependency 后
  `.js`、source map、`__velar_packages__` 和 synthetic runtime package 都不会残留，编译失败则
  保留上一份完整产物。`--out` 同步只认带 `velarGeneratedRuntime: 1` 的 synthetic
  `node_modules/velar`，拒绝覆盖 foreign package，同时删除当前结果不再生成的 owned CSS，
  并明确要求 `.js` 输出名。永久回归覆盖删除依赖后重建、失败重建保留、foreign package
  refusal、runtime package 收缩和 stale CSS 清理。最终生产扫描确认 15 个 consumer 中的
  `__velarListAppend`/`__velarMapSet`/`__velarRecordSet` 等 algorithm owner 已降为 0，只剩一个
  `compiler-runtime-collection-lowering-v1` owner；Lite CLI 也不再包含 `@velarscript/agent`。

  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、533/533 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 774,606 bytes（756.5 KiB），
  host 235,904、renderer 506,769、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `516330451ebee12a7f1782a248563ab1bfd356fb8ca226bd01b5f7897f8d71e4`；
  相对 W-98 减少 27,112 bytes，相对 W-91 累计减少 150,695 bytes。清理后的 generated
  consumer scan 只剩 11 份 runtime narrowing 与 4 份 index helper；下一波先审计
  NarrowingError identity 是否可提升为 project-shared stateless runtime，再处理依赖 collection
  lowering/host/reactive 的 index helper。VelarOS Desktop 产品工作树保持干净；Workbench
  仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-100 将 11 个 Core-shaped consumer 重复内联的 flow-narrowing runtime 收口为一个
  compiler-internal module。审计确认 `NarrowingError` 从未属于 VelarScript 公共 API；真正的
  语言契约是 stale narrowed read 必须在读取点重新验证，并以 `NarrowingError` 名称、稳定消息、
  预期类型、flow description 与 source offset 失败。project compilation 现在只导入隐藏模块的
  `narrow` operation，因此所有 consumer 共用同一个内部错误构造器；standalone `compile()` 仍从
  同一 canonical source 内联完整实现并保持自包含。内部模块无 `ModuleInterface`，没有把编译器
  实现细节变成可 import/reflection 的标准库能力。

  runtime 初始化时捕获原生 `TypeError`；永久测试在初始化后替换全局 `TypeError`，再同时触发
  compiled stale read 与直接 shared-module narrowing failure，两者仍保持原始 `TypeError`
  identity、稳定 `NarrowingError` 名称/消息和零 poison calls。双 consumer、standalone/shared、
  exact exports、development route 与 public Standard API absence 均有回归。Lite 的 20-module
  CLI 生产扫描确认 consumer 中 `class __VelarNarrowingError` / `function __velarNarrow` owner
  从 11 降为 0，只保留一个 `compiler-runtime-narrowing-v1` owner；调用点继续显式导入，未删除
  运行时检查。

  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、534/534 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 772,547 bytes（754.4 KiB），
  host 235,904、renderer 504,710、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `a574d0ccf87201064294e73ae03972dc30ea1a7dcc5b77afb28bbe6c6a20a3e9`；
  相对 W-99 减少 2,059 bytes，相对 W-91 累计减少 152,754 bytes。重新扫描后只剩 4 个
  consumer 拥有 index helper；下一波审计其对 collection host/lowering/reactive 的真实依赖，
  不能把 collection state、callback 或可观察 mutation 错误提升为 project-global runtime。
  VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件
  变化；未提交、未推送、未发布。

- W-101 将最后 4 个 consumer 重复内联的 strict/optional bracket read 与 bracket write helper
  归入既有 compiler-internal collection-lowering module，而不是再造公开包或第二个内部模块。
  它们复用同一模块已经拥有的 dense List / Record proof、collection host 与 reactive bridge；
  application List/Record、key/value 和 mutation effect 仍全部作为 consumer-owned 参数传入，
  没有提升 collection state。`IndexError` 从来不是公共构造器；现在 project 内只有一个内部
  identity，并继承初始化期捕获的原生 `RangeError`，standalone `compile()` 则从同一 canonical
  source 内联完整实现。optional index 仍以 thunk 接收 key，在 absent receiver 上保持零求值。

  永久 hostile execution 同时覆盖 List/Record 读写、same-value write、optional-key laziness、
  out-of-range `IndexError` 名称/原生 RangeError identity，以及初始化后 Array/Map/Set/Object/
  Number/Math/Reflect/Symbol/TypeError/RangeError、descriptors、iterators 与 mutation operations
  全面替换后的零 poison calls。全量首次只暴露一条旧 hygienic-name 测试仍要求直接继承 ambient
  `RangeError`；断言已按捕获 ABI 更新，随后全绿。Lite 20-module CLI 扫描确认 4 个调用
  consumer 仍保留 guard call，但 `class __VelarIndexError` / 三个 index function 的 consumer
  owner 从 4 降为 0，只剩 `compiler-runtime-collection-lowering-v1` 一个 canonical owner。

  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、534/534 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包为 770,542 bytes（752.5 KiB），
  host 235,904、renderer 502,705、capability host 30,540、metadata 1,393，外置 Node.js >=24，
  SHA-256 为 `4b3ebc40c3b84dc533dbc17c74b33feaa84aec11b620f7cd4d9570beb413f0f2`；
  相对 W-100 减少 2,005 bytes，相对 W-91 累计减少 154,759 bytes。重新提取 20 个 consumer
  的 top-level `__velar*` declarations 后，跨 consumer 重复 owner 已为 0；下一波转向 import/
  dependency 精度：当前 12 个 collection consumer 仍各自导入全部 lowering/host/reactive
  bindings，其中 host 636 个和 reactive 96 个 imported binding 在 consumer 中实际使用数均为
  0，必须让 transitive dependency 回到 lowering module owner，而不是继续扩大 consumer ABI。
  VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件
  变化；未提交、未推送、未发布。

- W-102 修正 project consumer 与 compiler-internal runtime 的 direct/transitive dependency
  所有权。普通 collection consumer 现在只直接 require/import collection-lowering module；其
  collection-host 与 reactive bridge 由 lowering module 已声明的 dependency closure 递归物化。
  只有仍在 consumer 内生成受控 Record construction、binding 或 structural match lowering 时，
  consumer 才直连 host/reactive ABI。纯 collection 双-module project 的每个 CompileResult 因此
  只声明 lowering module，而含 Record spread 的对照模块仍精确声明 lowering + host + reactive；
  standalone 路径继续内联完整依赖，dev/build/unbundled adapters 均通过同一 closure 取得模块。

  这次双路径验证还暴露并修复了一个独立语言正确性缺陷：受控 List/Record construction 把每个
  source expression 包装为 JavaScript thunk，却曾生成裸 `() => {field: value}`。对象字面量在
  JavaScript 中会被解释为 statement block 并返回 `undefined`，所以 `[...base, {value: 2}]` 与
  `{...{value: 3}}` 可静态通过却在运行时丢值。两类 thunk 现在统一生成括号化 expression，新增
  真实编译/执行回归同时覆盖 List 与 Record，永久 boundary guard 防止重新退化。

  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、535/535 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；12 个 consumer 中此前完全未使用的 636 个
  collection-host 与 96 个 reactive imported binding 已全部归零，重复 runtime owner 继续为 0。
  当前薄包仍为 770,542 bytes（752.5 KiB），host 235,904、renderer 502,705、capability host
  30,540、metadata 1,393，外置 Node.js >=24；内容因 compiler fix 改变，SHA-256 更新为
  `940ffcfe111841444691881a084150b3e502bfa65d9c9615ab00c5b2b0a57afa`。相对 W-91 累计仍减少
  154,759 bytes。重新 import-use 扫描留下 661 个 collection-lowering、223 个 primitive、120 个
  runtime-Type 与 14 个 class-field unused binding；下一波按 lowering hints/生成需求收紧 named
  imports，不能依赖 bundler 猜测语言 ABI。VelarOS Desktop 产品工作树保持干净；Workbench
  仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-103 将 project consumer 对四类 compiler-internal runtime 的 named imports 收紧为实际生成
  代码所需的精确集合，不再依赖后续 bundler 猜测并删除语言 ABI。primitive、class-field 与
  runtime-Type runtime 由 emitter 已完成的 statements/helpers 反查真实 `__velar*` 使用点后选择
  import；collection-lowering 从 canonical export list 选择调用点，并为 generated List binding
  helper 保留显式依赖。用户声明不能占用保留的 `__velar*` 名称，因此扫描对象仍完全属于编译器
  生成空间；hidden runtime module 的完整 export surface 和 standalone `compile()` 的 canonical
  inline runtime 均未收缩，也没有把应用值或状态提升到共享模块。

  永久回归分别锁定 primitive、class-field、runtime-Type 与 collection-lowering 的正向/负向导入，
  同时保留 exact hidden-module namespace、双 consumer、standalone/shared 与 hostile runtime
  execution 覆盖。Lite 重建后的 20 个 CLI consumer 逐条解析内部 import 并复查引用：W-102 留下
  的 661 个 collection-lowering、223 个 primitive、120 个 runtime-Type 和 14 个 class-field
  unused binding 已全部归零；七类 compiler runtime 合计每一个 imported binding 都有生成代码
  使用，跨 consumer 重复 top-level runtime owner 继续为 0。

  当前组合证据为 `npm run check`（98 个文档示例、60 项 runtime boundary）、535/535 串行
  compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release rehearsal、完整
  dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后浏览器项目、
  Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、51/51 Desktop
  三浏览器场景与生产构建。Lite 未接受产品补丁；当前薄包仍为 770,542 bytes（752.5 KiB），
  host 235,904、renderer 502,705、capability host 30,540、metadata 1,393，外置 Node.js >=24；
  bundler 此前已经能 tree-shake 这些无用 binding，因此体积未变，但生成代码和 ABI 已真实收紧，
  SHA-256 更新为 `2b69a2d8302e66f3228a47cb87d19b8acb58ab25f3ac83c63ecf1b6b6f89a7f6`。
  相对 W-91 累计仍减少 154,759 bytes。下一波不再按已清零的 runtime duplication 清单制造工作，
  而是重新审计 package graph、Node/Web/Desktop 等效语义和 Lite 真实用例暴露的语言/API 缺口。
  VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件
  变化；未提交、未推送、未发布。

- W-104 修复 W-103 import liveness 的通用精度漏洞。旧实现以
  `generatedCode.includes(name)` 判断 runtime operation 是否使用，因此
  `__velarStringReplaceAll` 会同时误命中前缀 `__velarStringReplace`，用户普通字符串或 f-string
  文本中的 `__velarStringTrim` 也会伪造一次 helper 使用。Lite 当前源码没有触发这些名字组合，
  所以 W-103 的生产扫描结果真实，但这个选择算法不能作为普遍语言契约保留。

  emitter 现在先对 generated statements 与 compiler-owned helper bodies 做轻量 JavaScript token
  扫描，只收集代码位置的完整 identifier；扫描跳过单/双引号、行/块注释和 template raw text，
  但递归进入 `${...}` 表达式并处理嵌套 template。import selection 只查询这个 identifier set，
  因而不再有 source-data pollution 或 prefix collision，也没有把 TypeScript/JavaScript parser
  变成编译器运行时依赖。永久回归同时证明 f-string raw text 不保留 `stringTrim`/`stringReplace`、
  其 interpolation 内的真实 `replaceAll` 仍被导入，以及 collection 的
  `__velarCollectionValues` 不会误保留 `__velarCollectionValue`；boundary guard 锁定 token scanner
  与 exact-set contract。

  当前组合证据为 `npm run check`（51 个格式化源、98 个文档示例、60 项 runtime boundary）、
  536/536 串行 compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance/release
  rehearsal、完整 dev/production/external-preview 与 27+6+15+6 Chromium/Firefox/WebKit、安装后
  浏览器项目、Workbench 安装态，以及 Lite 四项目 check、32+28 tests、package acceptance、
  51/51 Desktop 三浏览器场景与生产构建。重建后的 20 个 Lite CLI consumer 在七类内部
  runtime 上仍为 imported binding 100% 有用（合计逐项扫描为 0 unused；各模块计数保持
  10/10、59/59、5/5、11/11、41/41、16/16、120/120），没有产品补丁。当前薄包仍为
  770,542 bytes（752.5 KiB），SHA-256 仍为
  `2b69a2d8302e66f3228a47cb87d19b8acb58ab25f3ac83c63ecf1b6b6f89a7f6`；相对 W-91 累计减少
  154,759 bytes。VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数返回值推断
  相关的既有 5 文件变化；未提交、未推送、未发布。

- W-105 用 Lite 的真实命令工具补齐 `velar/process` 的增量输出能力。此前 `Process.wait()` 只能在
  进程结束后返回 stdout/stderr 聚合，纯 Vel Agent、构建器和 CLI 无法在运行期间消费输出；若让
  Lite 私造 callback/事件桥，会把语言标准库缺口错误留给产品层。公共契约现在采用 VelarScript
  既有 pull protocol：`Process.next() -> Promise<{channel, text}?>`，因此普通
  `async for output in process` 即可工作；`ProcessOutputChannel.stdout/stderr` 是带 runtime Type
  identity 的官方 enum。没有引入 JavaScript async iterator、回调特例或第二套 stream 抽象。

  Node、Desktop renderer 与隔离 worker 现在共享一个生命周期：每个 stdout/stderr 通道以独立
  `StringDecoder` 增量解码，跨 native chunk 的 UTF-8 code point 不会破碎；跨通道顺序按 host
  实际观察顺序交付；同一时刻只允许一个 pull；增量消费必须在 `wait()` 前完成，而直接
  `wait()` 仍是明确的 aggregate-only 路径；`stop()`、timeout、输出字节/百万 chunk 上限与进程树
  终止继续沿用一个所有权。Desktop bridge 新增 bounded `process.read`，renderer 与 worker 都
  重验 shape、channel、大小和 handle 生命周期；确定性 browser-test host 也实现同一协议，不能
  再用只支持 start/wait/stop 的假宿主掩盖目标漂移。

  Lite 首次通过纯 Vel `async for` 使用这个 API 时进一步暴露一个此前静态 probe 和直接
  `next()` 测试都遗漏的语言/宿主契约缺陷：`async for` 为拒绝 getter/prototype pollution，只接受
  instance-own data-valued `next`；官方 JavaScript `ProcessHandle` 却把 `next` 放在 class prototype，
  导致类型检查成功而真实执行抛出 “async for requires a data-valued next method”。Node/Desktop
  `Process.next` 现均为捕获 receiver 的 sealed instance-own capability，与语言 pull ABI 真正一致。
  新增永久回归实际执行 `.vel -> CLI -> child process -> async for -> wait`，另覆盖 stdout/stderr
  顺序、UTF-8 三字节字符跨两次 write、单 reader、pending read 与 wait 冲突、wait-only、read-after-
  wait、hostile accessor wire record 和 test-host read。runtime boundary guard 锁定 enum、own-next、
  read bridge、decoder 与 consume-before-wait 约束。

  当前组合证据为 `npm run check`（51 个格式化源、98 个文档示例、60 项 runtime boundary）、
  537/537 串行 compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance 与 release
  rehearsal、完整 dev/production/external-preview 和 27+6+15+6 Chromium/Firefox/WebKit、安装后
  browser project、Workbench 对本轮 rehearsal 六包的安装态验收。Lite 四项目 check、32 shared +
  28 server tests、package acceptance、17/17 Chromium、51/51 Desktop 三浏览器与生产构建全部
  通过；`ToolRun` 单测和真实 Desktop approval 场景都走公开 pull API。最终薄包为 776,148 bytes
  （758.0 KiB）：host 235,904、renderer 505,807、capability host 33,044、metadata 1,393，外置
  Node.js >=24，SHA-256 为
  `738c3be83cc3f78dc8a3551ef67a8397461152d799412abfe4a92ab2bbed3b6c`。相对 W-104 增加
  5,606 bytes（renderer +3,102、capability host +2,504），相对 W-91 仍累计减少 149,153 bytes。
  VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行返回值推断相关的既有 5 文件变化；
  未提交、未推送、未发布。

- W-106 继续用 Lite 的真实 `velar/process` 消费链审计宿主边界，发现 Node 与 Desktop 虽已拒绝
  accessor/继承字段并复用严格 UTF-8，但 options、环境 Map 与结果组装仍在模块初始化后动态读取
  `Array.isArray`、`Map.prototype.entries/size`、`Object`/`Reflect`、`Promise`、timer 等可变
  JavaScript 内建。普通依赖只需稍后替换这些全局或 prototype，就能改变官方进程 API 接受的值、
  触发非预期 getter，或让两个目标产生不同语义；这属于语言官方宿主 ABI 缺口，不能由 Lite 防御。

  `packages/node/src/process-runtime.ts` 现成为唯一内部
  `VELAR_PROCESS_HOST_RUNTIME` 所有者，在官方模块初始化时捕获验证、反射、Map iterator、正则、
  Promise、timer、Error 和 immutable-result 操作；两个目标另行组合 compiler-owned captured UTF-8
  runtime。Node 直接组合该 fragment；Desktop 只从 `@velarscript/node/compiler` 复用它，再叠加
  自己的 capability bridge/worker，不维护第二套语义。
  该 fragment 是 compiler-extension infrastructure，不是公开 Vel module，也没有引入 Agent、
  workspace 或产品工具概念。Node 的 child-process/StringDecoder 事件链和 Desktop 的隔离 worker
  仍分别属于目标宿主实现，未被虚报成一份跨目标 Node 传输 ABI。

  Node 的真实 child process 与 Desktop renderer 的确定性 bridge 均新增 post-initialization hostile
  intrinsic 回归：模块加载后替换 Array、Map、Number、Object、Reflect、RegExp、Set 和 String 的
  相关操作，显式 env Map、pull chunks 与最终结果仍完全一致且 poison 调用数为 0。runtime boundary
  guard 锁定 canonical source、Node import/export、Desktop reuse、UTF-8 组合，并禁止两个 process
  target 重新出现 ambient validation/result calls；同时修正旧 Desktop process 源码切片错误地一直
  延伸到 `DESKTOP_HTTP_SOURCE` 的检查盲区，现准确终止于 `DESKTOP_ENV_SOURCE`。

  当前组合证据为 `npm run check`（51 个格式化源、98 个文档示例、60 项 runtime boundary）、
  537/537 串行 compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance 与 publication
  rehearsal、完整 dev/production/external-preview 和 27+6+15+6 Chromium/Firefox/WebKit、安装后
  browser project，以及 Workbench 对本轮 rehearsal 六包的安装态验收。Lite 未加产品补丁：四项目
  check、32 shared + 28 server tests、package acceptance、17/17 Chromium、51/51 Desktop
  三浏览器与生产构建全部通过。最终薄包为 778,319 bytes（760.1 KiB）：host 235,904、renderer
  507,978、capability host 33,044、metadata 1,393，外置 Node.js >=24，SHA-256 为
  `9e715d76d099b1453f82d2af59a11d280977deda80b70f3e4c3ffd23c97bf5d5`。相对 W-105 仅增加
  2,171 bytes，全部来自 renderer 复用的 process host ABI；仍低于 1 MiB。VelarOS Desktop 产品
  工作树保持干净；Workbench 仍只有并行返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-107 补完 W-106 明确保留的 Node process transport 边界。最初按同类 host ABI 思路捕获
  `EventEmitter.on/once`、`ChildProcess.kill/unref`、`Writable.end`、`StringDecoder.write/end`、
  Buffer 与 `process.kill`；真实 hostile test 立即否定了这个表面方案：模块初始化后替换
  `EventEmitter.prototype.on`，Node 自己的 `spawn()` 会在创建 stdio Socket 时经
  `Readable.on` 再次动态调用 poisoned prototype，外层 wrapper 根本来不及接管。缩窄测试到
  “child 已经启动以后”只会掩盖生产缺陷，因此临时 direct-capture fragment 已删除，没有留下
  一套名义安全、实际仍共享 application Realm 的实现。

  Node `velar/process` 现在在官方模块完成求值前创建一个 compiler-owned Worker、传入私有
  MessagePort 并等待 ready handshake。Worker source 只静态 import `node:child_process`、
  `node:string_decoder` 和 `node:worker_threads`，不加载应用、npm 依赖、Agent 或工具策略；
  child/EventEmitter/stream/decoder/Buffer 全部在隔离 Realm 内运行。application-facing proxy
  只保留与 Desktop 一致的 `Process.next/wait/stop` pull contract，捕获 MessagePort/MessageEvent
  操作、严格复验 start/chunk/result/error records，并继续复用 W-106 的 value ABI 与 compiler UTF-8
  runtime。Worker 与 Desktop capability host 是两个目标各自的 privileged implementation，未把
  Desktop 或 Lite 架构塞回 Node 标准库。

  生命周期也成为显式契约：最多 128 个 unreleased handles；每个 pending request 与 running child
  会 ref 私有 port，保证调用者即使拿到 Process 后不立刻 `wait()`，父 CLI 也不会提前退出；child
  settled 后自动解除 running ref，空闲 import 不会永久挂住 event loop；`wait/stop` 释放 worker
  handle。新增独立父进程回归让未观察的 child 延迟写 marker 后自然退出，同时设 5 秒反向门禁，
  同时证明 active retention 与 idle release。已有 descendant tree、timeout、stop、pull ordering、
  one-reader、aggregate 与 UTF-8 语义保持不变。

  hostile 回归现在在 Worker ready 后同时替换 application Realm 的 Array/Map/Number/Object/Reflect/
  RegExp/Set/String、Buffer、ChildProcess、EventEmitter、Writable、StringDecoder、TypedArray byteLength、
  `process.kill`、MessagePort、MessageEvent 和 Worker operations，再启动真实 child、传显式 env Map、
  pull stdout/stderr 并 wait；poison 调用数为 0。boundary guard 锁定 eager handshake、static `node:`
  imports、128 handle ceiling、ready/settled protocol、captured MessagePort、active/idle ref ownership，
  并禁止 application-facing module 重新 import child_process/StringDecoder。

  当前组合证据为 `npm run check`（51 个格式化源、98 个文档示例、60 项 runtime boundary）、
  538/538 串行 compiler/runtime、四示例 check/Vel tests、六包 consumer acceptance 与 publication
  rehearsal，以及 Workbench 对本轮 rehearsal 六包的安装态验收。Lite 没有产品补丁：四项目 check、
  32 shared + 28 server tests（含真实 tool-process cancel）、package acceptance、17/17 Chromium、
  51/51 Desktop 三浏览器与生产构建全部通过。20 模块 Lite CLI 的生成 `velar/process.js` 为
  42,843 bytes；Node-only isolation 不进入 Desktop renderer，薄包仍为 778,319 bytes（760.1 KiB），
  SHA-256 仍为 `9e715d76d099b1453f82d2af59a11d280977deda80b70f3e4c3ffd23c97bf5d5`。
  VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行返回值推断相关的既有 5 文件变化；
  未提交、未推送、未发布。

- W-108 修复 `velar/terminal` 的无读取进程生命周期。此前 terminal Worker 虽然在模块空闲时
  unref，但 Worker source 求值时立即为重复后的 stdin descriptor 创建 `ReadStream`、注册 data/end/
  error 并 pause；只 import terminal 或仅写 stdout 的 CLI 仍可能被一个从未请求过的输入流拖住。
  这不是 Lite/CLI 退出补丁，而是官方 terminal ownership 错误。

  Worker 现在仍在模块求值时完成 ready handshake，保证隔离 transport 可用，但 stdin stream、
  decoder 和监听器只在第一次 `readLine` 时由 `ensureInput()` 创建。`close()` 在首次读取前调用会
  永久封住 reader，随后 `readLine()` 返回 `null`；读取已经开始时则沿用原有 destroy、closed
  handshake 和 creating Realm descriptor release。新增父进程回归故意让 stdin pipe 保持打开，
  只 import/完成普通工作后必须在 2 秒内自然退出；已有 pending fd read cancel、CR/LF、oversize、
  queued input、close-final、hostile intrinsic 与 active/idle ref 测试继续通过。没有引入 readline、
  application-Realm stream 或产品级退出特判。

- W-109 将 `velar/fs` 与 `velar/serve` 的 privileged effects 收敛到一个共享隔离 Node host。此前
  filesystem 虽捕获了 validation/result ABI，实际 callback `node:fs` 仍在 application Realm；
  serve 的 Node HTTP server、EventEmitter、request/response stream 和 backpressure 也与应用依赖
  共享 prototype。和 W-107 的 `spawn()` 一样，外层捕获 wrapper 不能阻止 Node 内部再次查找公共
  prototype，因此继续补 captured methods 会保留一套名义安全、实际可被依赖重定向的宿主。

  `packages/node` 现在声明 private compiler dependency `velar/node-host-v1`，由 extension dependency
  closure 递归物化，但没有 Standard API interface，用户代码不能 import。其 application-facing
  proxy 完成 eager ready handshake，捕获并复验 MessagePort 双向 records，最多允许 1,024 pending
  operations；idle 时 unref，pending operation 或 active server 时 ref。Worker source 只静态 import
  `node:buffer`、`node:fs/promises`、`node:http`、`node:path`、`node:worker_threads`，不加载 Vel 应用、
  npm dependency、Agent、workspace 或 Desktop 产品策略。

  `velar/fs` 留在应用 Realm 的只有 path/number/UTF-8/typed-byte/result validation 与 Blob capability；
  read/write/append/list/info/canonical/mkdir/copy/move/remove effects 全部走 Worker。`velar/serve` 留下
  handler、Vel request/response records、runtime Type、strict JSON/UTF-8 与 body-limit 语义；Worker
  独占 server/socket/request stream、body buffering、static-file confinement、header/output、stream
  backpressure 与 disconnect release。最多 128 个 active servers 和 4,096 个 active requests；proxy
  request id、server handle、request handle 均在 `Number.MAX_SAFE_INTEGER` 回绕并避开仍活跃身份，
  不把“并发有界”误当成“长期身份永不溢出”。

  测试物化器现按 extension dependency closure 安装 private runtime，覆盖源码内直接 compile、
  CLI、standard-export 枚举与 hardening harness，而不是依赖 monorepo 偶然可见路径。新增 filesystem
  hostile test 会在模块初始化后污染 Array/Number/Object/Promise/Reflect/TextEncoder/TextDecoder/
  TypedArray 等操作；serve hostile test 进一步污染 EventEmitter、Readable/Writable、Map、String、
  RegExp 等 application-Realm prototype，再发真实 HTTP 请求、读取快照 header、返回 body 并 stop，
  poison 调用数保持 0。IPv6、decoded path、strict body/JSON/Type、static file、opaque 500、stream
  backpressure 与 client disconnect 继续走真实 Worker transport。

  当前代码与文档的最终组合证据为 `npm run check`（51 个格式化源、98 个文档示例、60 项 runtime
  boundary）、543/543 串行 compiler/runtime/CLI/Desktop/hardening/publication rehearsal、四个生产示例
  check 与 1+3+3+3 个纯 Vel tests、独立六包 packed consumer acceptance 与 rehearsal、Workbench
  对该 rehearsal 六包的临时安装态验收、完整 dev/production/external-preview 和 27+6+15+6
  Chromium/Firefox/WebKit 加安装后 browser project，全部 exit 0。Lite 未加产品补丁：四项目 check、
  32 shared + 28 server tests、package acceptance、17/17 Chromium、51/51 Desktop 三浏览器与
  CLI/Desktop production build 全部通过。Node-only shared host 不进入 Desktop renderer，薄包仍为
  778,319 bytes（760.1 KiB）：host 235,904、renderer 507,978、capability host 33,044、metadata
  1,393，外置 Node.js >=24，SHA-256 仍为
  `9e715d76d099b1453f82d2af59a11d280977deda80b70f3e4c3ffd23c97bf5d5`。VelarOS Desktop 产品
  工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、
  未发布。

- W-110 补上 W-109 之后审计出的 aggregate resource ownership。旧实现限制单个 request body 为
  16 MiB、static file/stream 为 64 MiB、active requests 为 4,096，但这些上限可以相乘：大量并发
  handler 能让 Worker 同时保留远超合理进程预算的 body/file/response buffer。“每个值有限”不能
  证明宿主总体有界，这属于官方 `velar/serve` 资源契约，不应让 Lite 或每个产品自行限流。

  shared Node host Worker 现在额外拥有一个 128 MiB aggregate byte budget，统一覆盖 cached request
  bodies、已读 static files、待 flush 的 text/JSON response 与 in-flight stream chunks。request body 与
  file bytes 绑定 stable request ownership，只有 response transport 已 finish/close 且该 request 的
  active host operations 归零后才统一释放；close 与仍在进行的 body read/file read 并发时不会提前
  归还或二次释放。stream write 使用独立 transient reservation，直到 write callback flush、error 或
  close 才释放，并继续把 EPIPE 等目标细节归一为稳定的 “client connection is closed”。所有完成
  路径只经一个 `requests.delete` lifecycle gate，boundary guard 永久锁定聚合额度、双条件回收和
  transient ownership。

  新增真实 HTTP 回归把测试 Worker 的 aggregate budget 缩到 32 bytes：一个 handler 持有 24-byte
  cached body 时，竞争的 16-byte body 得到可捕获的 503；首请求完成后额度立即可复用；33-byte
  buffered response 和 static file 都通过原有 opaque failure contract 返回 500；随后普通请求仍为
  200，证明 exhaustion/failure 没有泄漏额度。最初实现把 stream chunk 计入 request stable bytes，
  disconnect 会让 close cleanup 与 write finally 二次释放；改成 transient reservation 后，既有真实
  backpressure/disconnect 回归先观察到 raw `write EPIPE`，最终按公共语义归一后与全部 Node 定向
  测试一起通过。

  当前最终组合证据为 `npm run check`、544/544 串行 compiler/runtime/CLI/Desktop/hardening/
  publication rehearsal、四个生产示例 check 与 1+3+3+3 个纯 Vel tests、独立六包 packed consumer
  acceptance/rehearsal、Workbench 安装态、完整 dev/production/external-preview 与 27+6+15+6
  Chromium/Firefox/WebKit 加安装后 browser project，全部 exit 0。Lite 未加产品补丁：四项目 check、
  32 shared + 28 server tests、package acceptance、17/17 Chromium、51/51 Desktop 三浏览器与
  CLI/Desktop production build 全部通过。Node-only aggregate ownership 不进入 Desktop renderer，
  薄包仍为 778,319 bytes（760.1 KiB），SHA-256 仍为
  `9e715d76d099b1453f82d2af59a11d280977deda80b70f3e4c3ffd23c97bf5d5`。VelarOS Desktop 产品
  工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、
  未发布。

- W-111 用 Lite 的真实 provider 请求链继续审计 `velar/http`，并否定了“捕获 application Realm
  的 `fetch`/`Headers` 就等于隔离传输”的旧假设。hostile test 在官方模块初始化后替换
  `String.prototype.toLowerCase`，Node/Undici 仍会在内部重新读取被污染的 prototype；继续增加
  wrapper capture 只能制造一条名义安全、实际可被依赖改变的边界，因此没有保留该临时方案。

  Node outbound HTTP 现在复用 private `velar/node-host-v1`，由隔离 Worker 独占 `node:http`、
  `node:https`、URL/redirect、socket、response stream、fatal incremental UTF-8 decode 与 cancel/close。
  application-facing `velar/http` 只保留 Vel value/Type、lazy request、option 与 secret descriptor
  snapshot、同步 URL/method validation、timer、host-result validation 和 typed parsing；没有
  Fetch、Headers、Response、ReadableStream 或 TextDecoder transport。Worker 二次验证所有 wire
  record，限制 1,024 个 active outbound requests、16 MiB request、64 MiB response、百万 chunks 与
  20 次 redirect；跨 origin redirect 去除 authorization/cookie/secret headers，303/POST rewrite 同时
  去除 content headers。secret value 只在首次 effect 时从捕获的原始 environment object 解析，再
  通过 private transport 送入 Worker；Vel 用户代码始终只能持有 branded descriptor。

  unread response 现在是明确的进程生命周期所有者：private port 在 response 完成、取消或关闭前
  保持 ref，空闲时自动 unref；proxy 以 exact handle 集合记账，pending cancel 不会错误释放另一个
  active response。Node/Web/Desktop 又统一补上 final-consumer cancellation recheck，修复“最后一个
  chunk 已到达、consumer 同步 cancel 后仍返回成功”的竞态。真实 Node HTTP 测试覆盖完整
  post-initialization intrinsic poisoning、secret rotation/missing value、metadata/declared-length/chunk
  bounds、invalid UTF-8、concurrent readers、redirect、timeout/cancel 与 unread-response active/idle
  release；Desktop bridge 回归覆盖 final chunk cancel。runtime boundary guard 锁定 private dependency、
  Worker static imports/ops/limits、exact lifecycle 和三目标最终取消语义，并禁止 application-facing
  Node HTTP 重新拥有 privileged transport。

  当前最终组合证据为 `npm run check`（51 个格式化源、98 个文档示例、60 项 runtime boundary）、
  546/546 串行 compiler/runtime/CLI/Desktop/hardening/publication rehearsal、四个生产示例 check 与
  1+3+3+3 个纯 Vel tests、独立六包 packed consumer acceptance/rehearsal、Workbench 对本轮
  rehearsal 六包的安装态验收、完整 dev/production/external-preview 与 27+6+15+6
  Chromium/Firefox/WebKit 加安装后 browser project，全部 exit 0。Lite 没有产品补丁：四项目
  check、32 shared + 28 server tests、package acceptance、17/17 Chromium、51/51 Desktop
  三浏览器与 CLI/Desktop production build 全部通过。Node-only outbound HTTP host 不进入 Desktop
  renderer；final cancellation check 只增加 57 bytes，薄包为 778,376 bytes（760.1 KiB）：host
  235,904、renderer 508,035、capability host 33,044、metadata 1,393，外置 Node.js >=24，SHA-256
  为 `adc2e4c0e31c5c3c1ab8de66da526b6df266421fddf174ea405d763a91eba65f`。VelarOS Desktop 产品
  工作树保持干净；Workbench 仍只有并行函数返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-112 用 Lite 的 provider retry/恢复策略补齐 `velar/http` 的跨目标失败分类。此前公开 API 只能
  区分非 2xx 的 `HttpError` 与取消/超时的 `HttpAbortError`；DNS、连接、socket 与 response stream
  断流仍是普通 `Error`。产品无法在不误重试协议错误、consumer callback 或工具失败的前提下识别
  网络瞬态故障，因此这不是 Lite 应自行用错误文本猜测的问题。

  Web、Node 与 Desktop 现在统一公开 `HttpTransportError` 和
  `HttpTransportPhase.request/response`。只有原生 request transport rejection 与 response body
  transport rejection 会进入该类型；HTTP 状态、UTF-8、额度、协议、consumer callback 与取消继续
  保留原有错误身份。Node private Worker、application proxy、Desktop capability Worker、renderer 与
  macOS WebView bridge 都对结构化错误做 exact validation，错误记录不能越权伪造公开类型。通用
  HTTP 包只提供可组合的失败事实，不拥有 retry/replay policy。

  Lite 的纯 Vel `OpenAIResponsesProvider` 据此实现产品策略：只在尚未收到任何 SSE payload 时重试
  408/429/500/502/503/504 或 `HttpTransportError`；一旦流已推进就绝不自动重放；退避以 25ms 上限
  分片等待，cancel 能及时打断当前请求或 backoff，同一 provider 取消后可以复用。测试覆盖 503 后
  成功、400 不重试、部分输出后终止不重试、退避取消与复用。本轮完成时显式 `ProviderTurn`
  contract 仍需要一个 unreachable throw，因为当时 Analyzer 尚未证明 literal-true loop 不会
  fall through；W-113 已在上游修复该控制流缺口并删除产品迁就。

  最终组合证据为 `npm run check`（51 个格式化源、98 个文档示例、61 项 runtime boundary）、
  547/547 串行 compiler/runtime/CLI/Desktop/hardening/publication rehearsal、四个生产示例 check 与
  1+3+3+3 个纯 Vel tests、六包 packed consumer acceptance、publication rehearsal、Workbench
  安装态验收，以及完整 dev/production/external-preview、27+6+15+6 三浏览器与 installed browser
  project，全部 exit 0。Lite 四项目 check、32 shared + 30 server tests、package acceptance、17/17
  Chromium、51/51 Desktop 三浏览器与 CLI/Desktop production build 也全部通过。薄包为 781,360
  bytes（763.0 KiB）：host 235,904、renderer 510,363、capability host 33,700、metadata 1,393，外置
  Node.js >=24，SHA-256 为 `06d9a6cd204b84f817908c20439501e2e305c8c9885270f41dee5404d2039458`；
  相比 W-111 增加 2,984 bytes。VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数
  返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

- W-113 从 W-112 留下的 unreachable throw 与 Lite 文件工具继续向上游追了两个生产缺口。函数
  返回值自动推断已经能收集 body returns 与 fallthrough，但显式非 null contract 仍把
  `while true` 当作可能自然结束；这使长期服务、retry pump 与 event loop 必须写永远不会执行的
  throw。Analyzer 现在在循环分析时只捕获该循环自己拥有的 reachable break：literal `while true`
  且没有 such break 时成为 non-fallthrough statement，同时参与显式返回检查、结果推断和 dead-tail
  flow。嵌套循环的 break 不会逃到外层；普通条件循环或外层可达 break 仍得到 VEL4006。Lite 已
  删除 provider retry loop 的 unreachable throw，原始纯 Vel 源直接通过。

  文件侧，旧 `lite:write` 先用 `info` 证明目标不存在，再调用会覆盖的 `writeText`。两个请求或一个
  新出现的 symlink 可以占据两次 host call 之间的入口，这既是 lost-create race，也是 authority
  TOCTOU；重复产品检查无法关闭它。`velar/fs` 现在跨 Node、Desktop renderer/capability Worker 与
  deterministic Desktop test host 公开 `createText(path, text)`。Node 与 Desktop 的 privileged Worker
  都直接执行 OS `wx` exclusive-create；现有 entry（包括 symlink）统一拒绝，检查和创建不可拆分。
  Lite 只把 `writeNew` 换成该公开 API，不知道 Worker、flag 或 bridge 实现。真实 Node 与 Desktop
  并发测试让两个 create 争抢同一路径，永久要求严格一个成功、一个稳定 already-exists failure，
  且最终内容只来自成功者；hostile ABI、installed packages 与 deterministic host 同时覆盖。

  最终组合证据为 `npm run check`（51 个格式化源、98 个文档示例、61 项 runtime boundary）、
  548/548 串行 compiler/runtime/CLI/Desktop/hardening/publication rehearsal、四个生产示例 check 与
  1+3+3+3 个纯 Vel tests、六包 packed consumer acceptance、publication rehearsal、Workbench
  安装态验收，以及完整 dev/production/external-preview、27+6+15+6 三浏览器与 installed browser
  project，全部 exit 0。Lite 四项目 check、32 shared + 30 server tests、package acceptance、17/17
  Chromium、51/51 Desktop 三浏览器与 CLI/Desktop production build 也全部通过。薄包为 781,836
  bytes（763.5 KiB）：host 235,904、renderer 510,453、capability host 34,086、metadata 1,393，外置
  Node.js >=24，SHA-256 为 `dd2349eb9a853ca63ddc4b8b8680f5de0eec753d785934cedf59573d5d58ecba`；
  相比 W-112 只增加 476 bytes。VelarOS Desktop 产品工作树保持干净；Workbench 仍只有并行函数
  返回值推断相关的既有 5 文件变化；未提交、未推送、未发布。

下一执行顺序：

1. W-113 的完整 compiler/runtime、六包安装/rehearsal、Workbench 安装态、三引擎 Web 与
   独立 Lite 全门禁均已取得当前代码的明确 exit 0。下一波继续审计安全原子 replace、provider
   多轮恢复和工具长期运行；provider policy 继续由 Lite 组合
   `velar/async` 与 typed HTTP failures，不塞进通用 HTTP 包，也不重复证明已经封闭的 Node host
   ownership、cancel 与 aggregate quota。
2. Lite 是从零独立重写的外部验证产品，不复用 VelarOS Desktop 的应用代码、私有包或产品架构；
   它只能像普通第三方一样消费公开的 `@velarscript/*` 包。继续扩展真实使用场景，但不得把产品
   Agent/provider/tool policy、workspace 或 approval UI 重新放回语言包。
3. 遇到目标间 API 分叉、测试 seam 缺失或边界
   假实现时先修语言/官方包，再改 Lite。相同问题按类别清理，不做页面特判。
4. 继续审计 Desktop transport、package graph、Node/Web 等效语义与产物可移植性；每个
   能力必须同时有静态契约、生成代码、运行时、权限失败和真实执行证据，才可视为完成。
   本轮产物可移植性、process、filesystem、path、environment、serve、terminal、host
   lifecycle、runtime Type registry、strict JSON/storage、Web host-event、browser-platform
   与 storage-host/Desktop-host
   切片已通过
   `npm run check`、完整串行测试、四个生产示例、27+6+15+6 三浏览器场景、六包安装消费、
   release rehearsal、独立 Lite 全门禁，以及 Workbench 对该 rehearsal 六包的安装态验收；
   仍未提交、未推送、未发布。
