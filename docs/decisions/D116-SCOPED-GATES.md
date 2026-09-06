# D116 — 按改动范围选套件的门禁（Scoped gates）

**状态**：所有者 2026-09-06 提出并裁定（「只有修改 web 才跑浏览器，其他的同理都只跑各自的」；
「比较重的测试只在发版前跑一次就行」）；
本文由编排会话写成规范，实现按 T1 / T2 两波落地。**上位记录**：D115（agent 可维护的代码组织）§五 P5
「测试镜像源码」——本文是它的门禁一侧。

## 一、问题

今天的四道门（`check` / `test` / `test:packages` / `test:browser`）加 `test:full` 对任何改动都全跑：
一个只改 `packages/node` 的波也要跑 Chromium 套件；一个只改文档措辞的波也要跑 3,000 个 Node 测试。
开发机顶不住，CI 账单也顶不住（VelarOS 曾因账单停摆）。而语言的包图是清楚的、发射产物的指纹是现成的，
「哪些套件的结论可能因这次改动而变」是可以算出来的。

## 二、原则

1. **健全优先于省时**：一个套件被跳过的唯一理由是「这次改动不可能改变它的结论」。可能性由两样东西
   判定：**包依赖闭包**（改了上游，下游必跑）与**发射产物指纹**（浏览器与打包验收只运行发射产物与
   运行时文件，产物逐字节不变则结论不变）。
2. **范围由 git 算，不由人报**：改动集 = `git diff --name-only <base>...HEAD` ∪ 工作区改动；`<base>`
   默认是与 `origin/main` 的 merge-base，可用 `--since <ref>` 指定。
3. **一条命令**：`npm run gate` 是默认门禁——算范围、跑该跑的、打印跳过了什么和为什么。
   `npm run gate -- --all` = 今天的五道门全跑；`release:check` 永远全跑。
4. **CI 同规**：PR 与 main 推送先算范围，再按范围起作业；每日一次与发版标签全跑。

## 三、包图与套件映射

包依赖（上游 → 下游）：`compiler → core → {web, node} → {desktop（组合 web + node）, server（组合 node）}`；
`cli` 与 `create` 在所有包之下（消费全部）。改动集里的每个路径按前缀归到一个**所有者**：
`packages/<p>/**` → 包 `p`；`tests/**` → 由测试文件自身的归属决定（见四）；`scripts/**`、根 `package.json`、
`tsconfig*.json`、`.github/**` → **仓库**（视为 compiler 之上的上游：全跑）；`docs/**`、`*.md`、
`docs/decisions/**` → **文档**（只跑 `check`）；`examples/**`、`tests/fixtures/**` → 归到它们声明的
目标包。

两个层级，两条命令：

| 层级 | 内容 | 何时跑 |
|---|---|---|
| **快层**（`npm run gate`，默认） | `check`（构建 + 各 `check:*`）+ 改动包**下游闭包**里各包的 Node 快测试 + 发射指纹与 lock 的比对 | 每个波、每次合并 |
| **重层**（`npm run release:check`） | 快层全部 + `test:browser`（Chromium）+ `test:packages`（打包消费验收）+ 历史 `hardening-*` + 性能 / marathon / dev-server 等重测试 | **发版前跑一次**；CI 里只在发版标签、每日一次与手动触发时跑 |

重测试的名单先由 `tests/heavy.json` 列出（T1 从一次 `test:full` 的逐测试时长里取阈值以上的文件，
连同浏览器与打包验收），T2 搬迁时改成 `.slow.test.ts` 后缀。仓库级改动（`scripts/**`、根 `package.json`、
tsconfig、`.github/**`）= 快层全部 Node 测试；文档改动 = 只跑 `check`。

**指纹作为门的输入**：`output-fingerprint.lock` 入库，记录每个夹具工程、每种模式的发射产物摘要
（今天的 `scripts/output-fingerprint.mjs` 已能生成）。`gate` 先构建再算指纹，与 lock 比对：有变而工作区未更新 lock → `gate` 红，提示
`npm run fingerprint -- --write output-fingerprint.lock`（改变发射产物必须是显式的、进 diff 的；重构片因此
自动获得「逐字节相同」的门，不再靠会话记忆的基线文件）。重层不在快层里，指纹是快层对「浏览器与打包结论
是否可能已变」的唯一线索：lock 未动 = 发射产物未动 = 那两个套件的结论未动；lock 动了 = 发版前必看。

## 四、测试文件的归属

T1 用**导入分析**推导：一个测试文件导入了哪些 `@velarscript/*` / `packages/*/src`、编译的夹具声明了哪些
`surfaces` / `extensions`、文件名前缀（`hardening-node-*`、`web-*`、`node-*`、`desktop-*`、`cli-*`）。
归属 = 它触及的包集合；跑与不跑看该集合与「改动包的下游闭包」是否相交。推导结果写成
`tests/ownership.generated.json`（生成文件，`check` 里重生成比对，与 `runtime-sources` 同法），
让归属可审、可测、可被 T2 的目录搬迁直接消费。

T2（等当前四波落地后的安静窗口）把测试搬进 `tests/<owner>/`（`compiler` `core` `web` `node` `server`
`desktop` `cli` `repo` `support`），147 个 `hardening-*` 按主题并入，`compiler.test.ts`（29,958 行）拆完
——这就是 D115 P5。搬迁后归属由目录给出，导入分析退为一致性检查。

## 五、对波的纪律（AGENTS.md 同步）

波在自己的 worktree 里跑 `npm run gate`（默认按范围），报告里写明跑了哪些套件、跳过了哪些及原因；
编排会话在集成分支上合并后再跑一次 `npm run gate`（范围 = 合并引入的改动）；发版跑 `release:check`。
以前「五道门全绿」的措辞改为「`gate` 全绿（列出所跑套件）」。

## 六、CI

`ci.yml` 新增首个作业 `scope`：checkout 后运行 `node scripts/gate-scope.mjs --json --since <base>`
（push：`github.event.before`；PR：base sha），输出 `suites`；快层作业按 `suites` 起停，重层作业
（浏览器、打包验收、`test:full`）只在 `schedule`（每日一次）、`push: tags: v*` 与 `workflow_dispatch` 时跑。
两个 Node 套件矩阵（ubuntu + macos）保留给快层；重层的 macos 只在标签时跑。
